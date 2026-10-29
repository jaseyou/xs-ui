#!/bin/bash

red='\033[0;31m'
green='\033[0;32m'
blue='\033[0;34m'
yellow='\033[0;33m'
plain='\033[0m'

xui_folder="${XUI_MAIN_FOLDER:=/usr/local/xs-ui}"
xui_service="${XUI_SERVICE:=/etc/systemd/system}"

# Don't edit this config
b_source="${BASH_SOURCE[0]}"
while [ -h "$b_source" ]; do
    b_dir="$(cd -P "$(dirname "$b_source")" > /dev/null 2>&1 && pwd || pwd -P)"
    b_source="$(readlink "$b_source")"
    [[ $b_source != /* ]] && b_source="$b_dir/$b_source"
done
cur_dir="$(cd -P "$(dirname "$b_source")" > /dev/null 2>&1 && pwd || pwd -P)"
script_name=$(basename "$0")

# Check command exist function
_command_exists() {
    type "$1" &> /dev/null
}

# Fail, log and exit script function
_fail() {
    local msg=${1}
    echo -e "${red}${msg}${plain}"
    exit 2
}

# Records this run's outcome for the panel's web updater to poll, since it
# launches this script detached and has no other way to learn whether it
# finished. Written to a fixed path outside XUI_MAIN_FOLDER so it survives
# the update regardless of what happens to that folder. The EXIT trap below
# covers every exit path in this file, including the bare `exit 1`/`exit 2`
# calls that don't go through _fail.
xui_update_run_id="${XUI_UPDATE_RUN_ID:-0}"
[[ "${xui_update_run_id}" =~ ^[0-9]+$ ]] || xui_update_run_id="0"
xui_update_status_file="${XUI_UPDATE_STATUS_FILE:-/etc/xs-ui/update-status.json}"

_write_update_status() {
    local state="$1"
    local exit_code="$2"
    local status_dir
    status_dir="$(dirname "${xui_update_status_file}")"
    mkdir -p "${status_dir}" > /dev/null 2>&1
    local tmp_file="${xui_update_status_file}.tmp.$$"
    printf '{"runId":"%s","state":"%s","exitCode":%s,"finishedAt":%s}\n' \
        "${xui_update_run_id}" "${state}" "${exit_code}" "$(date +%s)" > "${tmp_file}" 2> /dev/null
    mv -f "${tmp_file}" "${xui_update_status_file}" > /dev/null 2>&1
}

_report_update_exit() {
    local code=$?
    if [[ "${code}" -eq 0 ]]; then
        _write_update_status "success" "0"
    else
        _write_update_status "failed" "${code}"
    fi
}
trap _report_update_exit EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# check root
[[ $EUID -ne 0 ]] && _fail "FATAL ERROR: Please run this script with root privilege."

if _command_exists curl; then
    curl_bin=$(which curl)
else
    _fail "ERROR: Command 'curl' not found."
fi

# --- GitHub private-repo auth (optional) -------------------------------------
# Reads XUI_GH_TOKEN or the token file persisted by install.sh, then serves
# GitHub downloads through a per-host netrc file: credentials apply only to
# github.com / raw.githubusercontent.com / api.github.com and never leak to
# the S3 redirect targets of release assets.
GH_NETRC="/etc/xs-ui/.netrc"
GH_TOKEN_FILE="/etc/xs-ui/gh.token"
gh_curl() { "${curl_bin}" "$@"; }

gh_setup_auth() {
    local token="${XUI_GH_TOKEN:-}"
    if [[ -z "$token" && -s "$GH_TOKEN_FILE" ]]; then
        token=$(head -n1 "$GH_TOKEN_FILE" | tr -d '[:space:]')
    fi
    [[ -n "$token" ]] || return 0
    mkdir -p "$(dirname "$GH_NETRC")"
    local umask_bak
    umask_bak=$(umask)
    umask 077
    {
        echo "machine github.com login ${token} password x-oauth-basic"
        echo "machine raw.githubusercontent.com login ${token} password x-oauth-basic"
        echo "machine api.github.com login ${token} password x-oauth-basic"
    } > "$GH_NETRC"
    umask "$umask_bak"
    chmod 600 "$GH_NETRC"
    if [[ ! -s "$GH_TOKEN_FILE" ]]; then
        printf '%s
' "$token" > "$GH_TOKEN_FILE"
        chmod 600 "$GH_TOKEN_FILE"
    fi
    gh_curl() { "${curl_bin}" --netrc-file "$GH_NETRC" "$@"; }
}
gh_setup_auth


# Check OS and set release variable
if [[ -f /etc/os-release ]]; then
    source /etc/os-release
    release=$ID
elif [[ -f /usr/lib/os-release ]]; then
    source /usr/lib/os-release
    release=$ID
else
    _fail "Failed to check the system OS, please contact the author!"
fi
echo "The OS release is: $release"

arch() {
    case "$(uname -m)" in
        x86_64 | x64 | amd64) echo 'amd64' ;;
        i*86 | x86) echo '386' ;;
        armv8* | armv8 | arm64 | aarch64) echo 'arm64' ;;
        armv7* | armv7 | arm) echo 'armv7' ;;
        armv6* | armv6) echo 'armv6' ;;
        armv5* | armv5) echo 'armv5' ;;
        s390x) echo 's390x' ;;
        *) echo -e "${red}Unsupported CPU architecture!${plain}" && rm -f "${cur_dir}/${script_name}" > /dev/null 2>&1 && exit 2 ;;
    esac
}

echo "Arch: $(arch)"

gen_random_string() {
    local length="$1"
    openssl rand -base64 $((length * 2)) \
        | tr -dc 'a-zA-Z0-9' \
        | head -c "$length"
}

xui_env_file_path() {
    case "${release}" in
        ubuntu | debian | armbian)
            echo "/etc/default/xs-ui"
            ;;
        arch | manjaro | parch | alpine)
            echo "/etc/conf.d/xs-ui"
            ;;
        *)
            echo "/etc/sysconfig/xs-ui"
            ;;
    esac
}

load_xui_env() {
    local env_file
    env_file="$(xui_env_file_path)"
    if [[ -r "$env_file" ]]; then
        set -a
        # shellcheck disable=SC1090
        source "$env_file"
        set +a
    fi
}

install_base() {
    echo -e "${green}Updating and install dependency packages...${plain}"
    case "${release}" in
        ubuntu | debian | armbian)
            apt-get update > /dev/null 2>&1 && apt-get install -y -q cron curl tar tzdata socat openssl > /dev/null 2>&1
            ;;
        fedora | amzn | virtuozzo | rhel | almalinux | rocky | ol)
            dnf makecache -y > /dev/null 2>&1 && dnf install -y -q cronie curl tar tzdata socat openssl > /dev/null 2>&1
            ;;
        centos)
            if [[ "${VERSION_ID}" =~ ^7 ]]; then
                yum makecache -y > /dev/null 2>&1 && yum install -y -q cronie curl tar tzdata socat openssl > /dev/null 2>&1
            else
                dnf makecache -y > /dev/null 2>&1 && dnf install -y -q cronie curl tar tzdata socat openssl > /dev/null 2>&1
            fi
            ;;
        arch | manjaro | parch)
            pacman -Sy --noconfirm cronie curl tar tzdata socat openssl > /dev/null 2>&1
            ;;
        opensuse-tumbleweed | opensuse-leap)
            zypper refresh > /dev/null 2>&1 && zypper -q install -y cron curl tar timezone socat openssl > /dev/null 2>&1
            ;;
        alpine)
            apk update > /dev/null 2>&1 && apk add dcron curl tar tzdata socat openssl > /dev/null 2>&1
            ;;
        *)
            apt-get update > /dev/null 2>&1 && apt install -y -q cron curl tar tzdata socat openssl > /dev/null 2>&1
            ;;
    esac
}

config_after_update() {
    local panel_needs_restart=0

    echo -e "${yellow}xs-ui settings:${plain}"
    ${xui_folder}/xs-ui setting -show true
    ${xui_folder}/xs-ui migrate

    # Properly detect empty cert by checking if cert: line exists and has content after it
    local existing_cert=$(${xui_folder}/xs-ui setting -getCert true 2> /dev/null | grep 'cert:' | awk -F': ' '{print $2}' | tr -d '[:space:]')
    local existing_port=$(${xui_folder}/xs-ui setting -show true | grep -Eo 'port: .+' | awk '{print $2}')
    local existing_webBasePath=$(${xui_folder}/xs-ui setting -show true | grep -Eo 'webBasePath: .+' | awk '{print $2}' | sed 's#^/##')

    # Get server IP
    local URL_lists=(
        "https://api4.ipify.org"
        "https://ipv4.icanhazip.com"
        "https://v4.api.ipinfo.io/ip"
        "https://ipv4.myexternalip.com/raw"
        "https://4.ident.me"
        "https://check-host.net/ip"
    )
    local server_ip=""
    for ip_address in "${URL_lists[@]}"; do
        local response=$(curl -s -w "\n%{http_code}" --max-time 3 "${ip_address}" 2> /dev/null)
        local http_code=$(echo "$response" | tail -n1)
        local ip_result=$(echo "$response" | head -n-1 | tr -d '[:space:]"')
        if [[ "${http_code}" == "200" && "${ip_result}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            server_ip="${ip_result}"
            break
        fi
    done

    # Only used to print the access URL; never prompt, the web updater has no TTY.
    if [[ -z "$server_ip" ]]; then
        server_ip=$(hostname -I 2> /dev/null | awk '{print $1}')
        server_ip="${server_ip:-<server-ip>}"
    fi

    # Handle missing/short webBasePath
    if [[ ${#existing_webBasePath} -lt 4 ]]; then
        echo -e "${yellow}WebBasePath is missing or too short. Generating a new one...${plain}"
        local config_webBasePath=$(gen_random_string 18)
        ${xui_folder}/xs-ui setting -webBasePath "${config_webBasePath}"
        existing_webBasePath="${config_webBasePath}"
        panel_needs_restart=1
        echo -e "${green}New WebBasePath: ${config_webBasePath}${plain}"
    fi

    # An update only updates the panel: TLS stays exactly as configured. Set it up
    # explicitly from the xs-ui menu (SSL Certificate Management).
    local access_scheme="http" access_host="${server_ip}"
    if [[ -n "$existing_cert" ]]; then
        access_scheme="https"
        access_host=$(basename "$(dirname "$existing_cert")")
    fi
    echo ""
    echo -e "${green}═══════════════════════════════════════════${plain}"
    echo -e "${green}     Panel Access Information              ${plain}"
    echo -e "${green}═══════════════════════════════════════════${plain}"
    echo -e "${green}Access URL: ${access_scheme}://${access_host}:${existing_port}/${existing_webBasePath}${plain}"
    echo -e "${green}═══════════════════════════════════════════${plain}"
    if [[ -z "$existing_cert" ]]; then
        echo -e "${yellow}No SSL certificate is configured; the panel is served over HTTP.${plain}"
        echo -e "${yellow}Run 'xs-ui' and choose SSL Certificate Management to set one up.${plain}"
    fi

    if [[ "$panel_needs_restart" -eq 1 ]]; then
        echo -e "${yellow}Restarting panel to apply the new web base path...${plain}"
        systemctl restart xs-ui 2> /dev/null || rc-service xs-ui restart 2> /dev/null
    fi
}

# setup_fail2ban auto-installs and configures fail2ban for the IP Limit feature
# by invoking the freshly downloaded xs-ui CLI. IP Limit is load-bearing on
# fail2ban (without it the panel disables the limitIp field and zeroes existing
# limits), so updating an older install should make it work without a manual
# trip through the IP Limit menu. Non-fatal: a fail2ban failure must never abort
# the update. XUI_ENABLE_FAIL2BAN is honored (load_xui_env exports it from the
# persisted env file, so a deliberate opt-out survives updates).
setup_fail2ban() {
    if [[ -n "${XUI_ENABLE_FAIL2BAN+x}" && "${XUI_ENABLE_FAIL2BAN}" != "true" ]]; then
        echo -e "${yellow}XUI_ENABLE_FAIL2BAN=${XUI_ENABLE_FAIL2BAN}, skipping Fail2ban auto-setup.${plain}"
        return 0
    fi

    if [[ ! -x /usr/bin/xs-ui ]]; then
        echo -e "${yellow}xs-ui CLI not found; skipping Fail2ban auto-setup.${plain}"
        return 0
    fi

    # Scripts older than v3.4.0 have no setup-fail2ban and exit 0 from the
    # usage banner, which would read as success here.
    if ! grep -q '"setup-fail2ban")' /usr/bin/xs-ui; then
        echo -e "${yellow}This xs-ui.sh predates 'xs-ui setup-fail2ban'; skipping Fail2ban auto-setup.${plain}"
        return 0
    fi

    echo -e "${green}Setting up Fail2ban for the IP Limit feature...${plain}"
    if /usr/bin/xs-ui setup-fail2ban; then
        echo -e "${green}Fail2ban setup complete.${plain}"
    else
        echo -e "${yellow}Fail2ban setup did not finish; IP Limit stays disabled until you run 'xs-ui' and open the IP Limit menu. Continuing.${plain}"
    fi
    return 0
}

# The hardened unit makes /usr, /boot, /efi and /etc read-only. The panel's own
# updater is expected to escape that sandbox by running this script through a
# transient systemd-run unit; when systemd-run is unavailable it starts this
# script as a plain child instead, and that child inherits the sandbox and then
# cannot write anything this update needs. Say so once, up front, instead of
# dying partway through with "Failed to download xs-ui".
require_writable_update_paths() {
    local dir probe
    for dir in "${xui_folder%/*}" "/usr/bin"; do
        [[ -n "$dir" && -d "$dir" ]] || continue
        probe="${dir}/.xs-ui-write-test.$$"
        # A real write test rather than [[ -w ]]: this runs as root, where a
        # permission bit means little and the test only reflects the file mode
        # and the mount flags, not an immutable attribute or a full filesystem.
        if ! : > "$probe" 2> /dev/null; then
            _fail "ERROR: ${dir} is not writable for this process (read-only mount, attribute or full filesystem). The panel's fallback updater cannot run inside the hardened systemd sandbox; update from the panel UI (which uses systemd-run) or run 'xs-ui update' in a shell."
        fi
        rm -f "$probe"
    done
}

# Major version of the local systemd, 0 when it cannot be determined. The
# SystemCallFilter=@system-service group only exists from systemd 239 on (other
# @-named groups exist since 231); on older versions an unknown group is not
# ignored safely, the filter stays in force and leaves a whitelist the panel
# cannot run under.
_xui_systemd_major_version() {
    local version=""
    if command -v systemctl > /dev/null 2>&1; then
        version="$(systemctl --version 2>/dev/null | awk 'NR == 1 {print $2}')"
    fi
    if [[ ! "$version" =~ ^[0-9]+$ ]]; then
        echo 0
        return 0
    fi
    echo "$version"
}

# The shipped units list hardening that older systemd does not know: the
# directive is logged and ignored at load time rather than rejected, so the
# panel still starts, only without that protection. Each entry is the systemd
# release that introduced the directive (systemd.exec(5)); everything else in
# the unit predates the oldest systemd install.sh supports (CentOS 7 has 219).
# SystemCallFilter= is listed because the drop-in only writes it from 239 on.
_xui_warn_unsupported_hardening() {
    local version entry missing=""
    version="$(_xui_systemd_major_version)"
    [[ "$version" -gt 0 ]] || return 0
    for entry in RestrictRealtime:231 ReadWritePaths:231 ProtectKernelTunables:232 \
        ProtectKernelModules:232 RestrictNamespaces:233 LockPersonality:235 \
        SystemCallFilter:239 ProtectHostname:242 RestrictSUIDSGID:242 \
        ProtectKernelLogs:244 ProtectClock:245; do
        if [[ "$version" -lt "${entry##*:}" ]]; then
            missing="${missing:+$missing, }${entry%%:*} (${entry##*:})"
        fi
    done
    [[ -n "$missing" ]] || return 0
    echo -e "${yellow}Note: systemd ${version} ignores part of the hardening in xs-ui.service; the panel still starts.${plain}"
    echo "      Not applied, needs a newer systemd: ${missing}."
    if [[ "$version" -lt 231 ]]; then
        echo "      The panel's folders stay writable through ReadWriteDirectories=, the alias this script installs."
    fi
    echo "      The rest of the hardening is in force. Upgrade systemd to apply the above."
    return 0
}

# ProtectSystem=full makes /usr, /boot, /efi and /etc read-only. ProtectSystem=
# strict would make the whole hierarchy read-only (only the kernel API
# filesystems stay as they are), and that would break the panel's own use of
# /tmp. The panel's stores are configurable (XUI_DB_FOLDER, XUI_LOG_FOLDER,
# XUI_BIN_FOLDER), and XUI_MAIN_FOLDER is the folder install.sh/update.sh place
# the files in -- the unit's WorkingDirectory on a stock install, and what a
# relative XUI_BIN_FOLDER is resolved against. So a hard-coded list in the unit
# either misses a relocated store -- the panel then cannot write its own SQLite
# database and sits in a Restart=on-failure loop -- or forces the operator to
# edit a file that every install/update overwrites from the release tarball.
# install.sh and update.sh therefore regenerate the drop-in from the folders
# actually in use, and the unit's own ReadWritePaths only carry the
# plain-install defaults. A relocated store means re-running install or update:
# the drop-in is only written here.
_xui_service_write_paths_dropin() {
    # $1 is the env file to resolve the XUI_* folders from; callers pass nothing
    # and get the OS-specific path the unit itself uses.
    local env_file="${1:-}"
    local dropin_dir dropin temp_file
    local db_folder log_folder bin_folder main_folder
    local path line="" whitespace_paths="" seen_paths="" escaped_path

    if [[ -z "$env_file" ]]; then
        env_file="$(xui_env_file_path)"
    fi
    if [[ -r "$env_file" ]]; then
        set -a
        # shellcheck disable=SC1090
        source "$env_file"
        set +a
    fi

    # XUI_* wins over the script's own default: the unit hands that same env
    # file to the panel through EnvironmentFile=, so these are the folders it
    # will actually use.
    main_folder="${XUI_MAIN_FOLDER:-${xui_folder}}"
    db_folder="${XUI_DB_FOLDER:-/etc/xs-ui}"
    log_folder="${XUI_LOG_FOLDER:-/var/log/xs-ui}"
    # An empty XUI_BIN_FOLDER resolves to "bin" relative to the panel's working
    # directory, which the unit sets to the main folder.
    bin_folder="${XUI_BIN_FOLDER:-bin}"
    if [[ "$bin_folder" != /* ]]; then
        bin_folder="${main_folder%/}/${bin_folder#./}"
    fi

    for path in "$db_folder" "$log_folder" "$bin_folder" "$main_folder"; do
        [[ "$path" == /* ]] || continue
        # ReadWritePaths= is a whitespace-separated list, and a folder whose
        # name contains whitespace cannot be written into it without relying on
        # quoting. A wrong entry makes systemd reject the whole drop-in and the
        # panel would not start, so leave such a folder out and say so instead.
        if [[ "$path" != "${path//[[:space:]]/}" ]]; then
            whitespace_paths="${whitespace_paths:+$whitespace_paths }$path"
            continue
        fi
        case " $seen_paths " in
            *" $path "*) continue ;;
        esac
        seen_paths="${seen_paths}${seen_paths:+ }$path"
        # systemd expands %-specifiers in unit files, so a folder name carrying
        # a literal % has to be written as %%, or the entry stops naming the
        # folder systemd is meant to keep writable.
        escaped_path="${path//%/%%}"
        line="${line} -${escaped_path}"
    done
    if [[ -n "$whitespace_paths" ]]; then
        echo "Warning: these folders contain whitespace and were left out of" >&2
        echo "         10-xui-sandbox.conf: $whitespace_paths" >&2
        echo "         The panel cannot write to them under the unit's sandbox." >&2
    fi
    line="${line# }"
    [[ -n "$line" ]] || return 1

    dropin_dir="${xui_service}/xs-ui.service.d"
    dropin="${dropin_dir}/10-xui-sandbox.conf"
    temp_file="${dropin}.tmp.$$"

    mkdir -p "$dropin_dir" || return 1
    cat > "$temp_file" << EOF
# Regenerated by install.sh/update.sh on every install and update: edits here
# are lost, and the list only reflects the XUI_* variables read from
# ${env_file} at that moment. Re-run install/update after moving a store.
# It lists the folders the panel writes to. Put local additions in their own
# drop-in, for example 20-xs-ui-local.conf, which nothing here touches.
[Service]
ReadWritePaths=${line}
ReadWriteDirectories=${line}
EOF
    if [[ "$(_xui_systemd_major_version)" -ge 239 ]]; then
        cat >> "$temp_file" << 'EOF'
# @system-service needs systemd >= 239; on older versions the unknown group
# would leave the panel with a filter it cannot start under (xs-ui.service.*).
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
EOF
    fi
    if [[ ! -s "$temp_file" ]]; then
        rm -f "$temp_file"
        return 1
    fi
    chmod 644 "$temp_file"
    mv -f "$temp_file" "$dropin" || { rm -f "$temp_file"; return 1; }
    if command -v systemctl > /dev/null 2>&1; then
        systemctl daemon-reload > /dev/null 2>&1 || true
    fi
    return 0
}

# Lands a systemd unit file at ${xui_service}/xs-ui.service via a temp file +
# atomic mv, so a failed cp/curl or an interrupted mv never leaves a
# truncated unit file at the live path -- systemd would then fail to parse
# it on the next daemon-reload/start. Same pattern already used for
# /usr/bin/xs-ui elsewhere in this script. source_is_url picks cp (from a
# file already extracted from the release tarball) vs curl (GitHub fallback).
_install_xui_service_unit() {
    local source="$1"
    local source_is_url="$2"
    local dest="${xui_service}/xs-ui.service"
    local temp_file="${dest}.tmp.$$"

    rm -f "$temp_file"
    if [[ "$source_is_url" == "true" ]]; then
        gh_curl -fLRo "$temp_file" "$source" > /dev/null 2>&1
    else
        cp -f "$source" "$temp_file" > /dev/null 2>&1
    fi
    if [[ $? -ne 0 ]]; then
        rm -f "$temp_file"
        return 1
    fi
    if [[ ! -s "$temp_file" ]]; then
        rm -f "$temp_file"
        return 1
    fi
    mv -f "$temp_file" "$dest"
    if [[ $? -ne 0 ]]; then
        rm -f "$temp_file"
        return 1
    fi
    if ! _xui_service_write_paths_dropin; then
        echo -e "${yellow}Warning: could not refresh ${xui_service}/xs-ui.service.d/10-xui-sandbox.conf.${plain}"
        echo -e "${yellow}If XUI_DB_FOLDER or XUI_LOG_FOLDER points outside /etc/xs-ui and /var/log/xs-ui, the panel may not be able to write to it under ProtectSystem=full.${plain}"
    fi
    _xui_warn_unsupported_hardening
    return 0
}

# Older tags predate some of these files (xs-ui.rc arrived in v2.8.4). Serving
# main's copy against an old binary is the mismatch this pinning exists to
# prevent, so probe before the old install is removed and refuse the tag.
require_repo_files() {
    local ref="$1" name status
    shift
    [[ "${ref}" == "main" ]] && return 0
    for name in "$@"; do
        status=$(gh_curl -sIL --retry 3 --connect-timeout 15 -o /dev/null -w '%{http_code}' "https://raw.githubusercontent.com/jaseyou/xs-ui/${ref}/${name}")
        if [[ "${status}" != "200" ]]; then
            _fail "ERROR: ${name} is not available for ${ref} (HTTP ${status}). Update to a release that ships it, or to 'dev-latest'. The current installation is untouched."
        fi
    done
}

update_xs-ui() {
    cd ${xui_folder%/xs-ui}/

    load_xui_env

    if [ -f "${xui_folder}/xs-ui" ]; then
        current_xui_version=$(${xui_folder}/xs-ui -v)
        echo -e "${green}Current xs-ui version: ${current_xui_version}${plain}"
    else
        _fail "ERROR: Current xs-ui version: unknown"
    fi

    echo -e "${green}Downloading new xs-ui version...${plain}"

    # XUI_UPDATE_TAG lets the panel target a specific release tag (e.g. the
    # rolling dev-latest pre-release). Empty keeps the default latest-stable flow.
    if [[ -n "${XUI_UPDATE_TAG}" ]]; then
        tag_version="${XUI_UPDATE_TAG}"
        echo -e "${green}Using update tag: ${tag_version}${plain}"
    else
        tag_version=$(gh_curl -Ls "https://api.github.com/repos/jaseyou/xs-ui/releases/latest" 2> /dev/null | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
        if [[ ! -n "$tag_version" ]]; then
            _fail "ERROR: Failed to fetch xs-ui version, it may be due to GitHub API restrictions, please try it later"
        fi
    fi
    echo -e "Got xs-ui latest version: ${tag_version}, beginning the installation..."
    # xs-ui.sh, xs-ui.rc and the unit files must come from the same release as
    # the binary; only the rolling dev build tracks main.
    script_ref="${tag_version}"
    if [[ "${tag_version}" == "dev-latest" ]]; then
        script_ref="main"
    fi
    # The unit files are only fetched when the release tarball lacks them, so
    # they are checked at that point instead of here.
    local required_files=("xs-ui.sh")
    [[ $release == "alpine" ]] && required_files+=("xs-ui.rc")
    require_repo_files "${script_ref}" "${required_files[@]}"
    gh_curl -fLRo ${xui_folder}-linux-$(arch).tar.gz https://github.com/jaseyou/xs-ui/releases/download/${tag_version}/xs-ui-linux-$(arch).tar.gz 2> /dev/null
    if [[ $? -ne 0 ]]; then
        _fail "ERROR: Failed to download xs-ui, please be sure that your server can access GitHub"
    fi
    if [[ ! -s ${xui_folder}-linux-$(arch).tar.gz ]]; then
        rm ${xui_folder}-linux-$(arch).tar.gz -f > /dev/null 2>&1
        _fail "ERROR: Downloaded xs-ui release archive is empty, please be sure that your server can access GitHub"
    fi
    # Releases publish <asset>.sha256 next to each archive. A mismatch or a
    # failed sidecar download aborts the update; only a 404 (releases
    # predating the sidecar) is tolerated with a warning.
    archive="${xui_folder}-linux-$(arch).tar.gz"
    rm -f "${archive}.sha256"
    sidecar_code=$(gh_curl -sL --retry 3 --retry-delay 3 --connect-timeout 15 --max-time 60 -o "${archive}.sha256" -w '%{http_code}' "https://github.com/jaseyou/xs-ui/releases/download/${tag_version}/xs-ui-linux-$(arch).tar.gz.sha256" 2> /dev/null)
    if [[ "${sidecar_code}" == "200" ]]; then
        expected_sha256=$(awk 'NR == 1 {print $1}' "${archive}.sha256")
        actual_sha256=$(sha256sum "${archive}" | awk '{print $1}')
        rm -f "${archive}.sha256"
        if [[ ! "${expected_sha256}" =~ ^[0-9a-f]{64}$ || "${expected_sha256}" != "${actual_sha256}" ]]; then
            rm -f "${archive}"
            _fail "ERROR: Checksum mismatch for $(basename "${archive}"): expected ${expected_sha256:-<none>}, got ${actual_sha256}"
        fi
        echo -e "${green}Checksum verified: ${actual_sha256}${plain}"
    elif [[ "${sidecar_code}" == "404" ]]; then
        rm -f "${archive}.sha256"
        echo -e "${yellow}No checksum published for this release, skipping verification${plain}"
    else
        rm -f "${archive}.sha256" "${archive}"
        _fail "ERROR: Failed to download the checksum for xs-ui-linux-$(arch).tar.gz (HTTP ${sidecar_code})"
    fi

    if [[ -e ${xui_folder}/ ]]; then
        echo -e "${green}Stopping xs-ui...${plain}"
        if [[ $release == "alpine" ]]; then
            if [ -f "/etc/init.d/xs-ui" ]; then
                rc-service xs-ui stop > /dev/null 2>&1
                rc-update del xs-ui > /dev/null 2>&1
                echo -e "${green}Removing old service unit version...${plain}"
                rm -f /etc/init.d/xs-ui > /dev/null 2>&1
            else
                rm xs-ui-linux-$(arch).tar.gz -f > /dev/null 2>&1
                _fail "ERROR: xs-ui service unit not installed."
            fi
        else
            if [ -f "${xui_service}/xs-ui.service" ]; then
                systemctl stop xs-ui > /dev/null 2>&1
                systemctl disable xs-ui > /dev/null 2>&1
                echo -e "${green}Removing old systemd unit version...${plain}"
                rm ${xui_service}/xs-ui.service -f > /dev/null 2>&1
                systemctl daemon-reload > /dev/null 2>&1
            else
                rm xs-ui-linux-$(arch).tar.gz -f > /dev/null 2>&1
                _fail "ERROR: xs-ui systemd unit not installed."
            fi
        fi
        # Kill any leftover mtg (MTProto) sidecars. xs-ui runs them outside its own
        # lifecycle, so on Linux a stale one can survive the stop and keep holding
        # an inbound port with an outdated secret, silently breaking new clients.
        # The new panel respawns a clean mtg per inbound on next start.
        pkill -f 'mtg-linux-[^ ]* run ' > /dev/null 2>&1 || true
        pkill -f 'tuic-server.*-c .*bin/tuic/tuic_[0-9]+\.json' > /dev/null 2>&1 || true
        echo -e "${green}Removing old xs-ui version...${plain}"
        rm ${xui_folder} -f > /dev/null 2>&1
        rm ${xui_folder}/xs-ui.service -f > /dev/null 2>&1
        rm ${xui_folder}/xs-ui.service.debian -f > /dev/null 2>&1
        rm ${xui_folder}/xs-ui.service.arch -f > /dev/null 2>&1
        rm ${xui_folder}/xs-ui.service.rhel -f > /dev/null 2>&1
        rm ${xui_folder}/xs-ui -f > /dev/null 2>&1
        rm ${xui_folder}/xs-ui.sh -f > /dev/null 2>&1
        echo -e "${green}Removing old mtg version...${plain}"
        rm ${xui_folder}/bin/mtg-linux-$(arch) -f > /dev/null 2>&1
        echo -e "${green}Removing old xray version...${plain}"
        rm ${xui_folder}/bin/xray-linux-$(arch) -f > /dev/null 2>&1
        echo -e "${green}Removing old README and LICENSE file...${plain}"
        rm ${xui_folder}/bin/README.md -f > /dev/null 2>&1
        rm ${xui_folder}/bin/LICENSE -f > /dev/null 2>&1
        rm ${xui_folder}/bin/tuic-server -f > /dev/null 2>&1
        rm ${xui_folder}/bin/tuic -rf > /dev/null 2>&1
    else
        rm xs-ui-linux-$(arch).tar.gz -f > /dev/null 2>&1
        _fail "ERROR: xs-ui not installed."
    fi

    echo -e "${green}Installing new xs-ui version...${plain}"
    tar zxvf xs-ui-linux-$(arch).tar.gz > /dev/null 2>&1
    if [[ $? -ne 0 ]]; then
        rm xs-ui-linux-$(arch).tar.gz -f > /dev/null 2>&1
        _fail "ERROR: Failed to extract the xs-ui release archive -- the previous installation has already been removed, so the panel will not start until this is fixed; try running the update again"
    fi
    rm xs-ui-linux-$(arch).tar.gz -f > /dev/null 2>&1
    cd xs-ui > /dev/null 2>&1
    if [[ $? -ne 0 || ! -s xs-ui ]]; then
        _fail "ERROR: Extracted xs-ui archive is missing the xs-ui binary -- the previous installation has already been removed, so the panel will not start until this is fixed; try running the update again"
    fi
    chmod +x xs-ui > /dev/null 2>&1

    # Check the system's architecture and rename the file accordingly.
    # The panel binary maps GOARCH=arm to "arm32" (internal/xray/process.go),
    # so the Xray binary must be named xray-linux-arm32; mtg keeps plain "arm".
    if [[ $(arch) == "armv5" || $(arch) == "armv6" || $(arch) == "armv7" ]]; then
        mv bin/xray-linux-$(arch) bin/xray-linux-arm32 > /dev/null 2>&1
        chmod +x bin/xray-linux-arm32 > /dev/null 2>&1
        if [[ -f bin/mtg-linux-$(arch) ]]; then
            mv bin/mtg-linux-$(arch) bin/mtg-linux-arm > /dev/null 2>&1
            chmod +x bin/mtg-linux-arm > /dev/null 2>&1
        fi
    fi

    chmod +x xs-ui bin/xray-linux-$(arch) > /dev/null 2>&1
    if [[ -f bin/mtg-linux-arm ]]; then
        chmod +x bin/mtg-linux-arm > /dev/null 2>&1
    elif [[ -f bin/mtg-linux-$(arch) ]]; then
        chmod +x bin/mtg-linux-$(arch) > /dev/null 2>&1
    fi

    echo -e "${green}Downloading and installing xs-ui.sh script...${plain}"
    local xui_script_temp="/usr/bin/xs-ui-temp.$$"
    rm -f "${xui_script_temp}"
    gh_curl -fLRo "${xui_script_temp}" "https://raw.githubusercontent.com/jaseyou/xs-ui/${script_ref}/xs-ui.sh" > /dev/null 2>&1
    if [[ $? -ne 0 ]]; then
        rm -f "${xui_script_temp}"
        _fail "ERROR: Failed to download xs-ui.sh script, please be sure that your server can access GitHub"
    fi
    if [[ ! -s "${xui_script_temp}" ]]; then
        rm -f "${xui_script_temp}"
        _fail "ERROR: Downloaded xs-ui.sh script is empty, please be sure that your server can access GitHub"
    fi
    mv -f "${xui_script_temp}" /usr/bin/xs-ui
    if [[ $? -ne 0 ]]; then
        rm -f "${xui_script_temp}"
        _fail "ERROR: Failed to install xs-ui.sh script"
    fi

    chmod +x ${xui_folder}/xs-ui.sh > /dev/null 2>&1
    chmod +x /usr/bin/xs-ui > /dev/null 2>&1
    mkdir -p /var/log/xs-ui > /dev/null 2>&1

    echo -e "${green}Changing owner...${plain}"
    chown -R root:root ${xui_folder} > /dev/null 2>&1

    if [ -f "${xui_folder}/bin/config.json" ]; then
        echo -e "${green}Changing on config file permissions...${plain}"
        chmod 640 ${xui_folder}/bin/config.json > /dev/null 2>&1
    fi

    # Finish the schema/data migrations before the service starts, so the service and
    # config_after_update's CLI calls never run them on the same database at once (#6728).
    echo -e "${green}Migrating database...${plain}"
    "${xui_folder}/xs-ui" migrate

    if [[ $release == "alpine" ]]; then
        echo -e "${green}Downloading and installing startup unit xs-ui.rc...${plain}"
        xui_rc_temp="/etc/init.d/xs-ui.tmp.$$"
        rm -f "${xui_rc_temp}"
        gh_curl -fLRo "${xui_rc_temp}" "https://raw.githubusercontent.com/jaseyou/xs-ui/${script_ref}/xs-ui.rc" > /dev/null 2>&1
        if [[ $? -ne 0 ]]; then
            rm -f "${xui_rc_temp}"
            _fail "ERROR: Failed to download startup unit xs-ui.rc, please be sure that your server can access GitHub"
        fi
        if [[ ! -s "${xui_rc_temp}" ]]; then
            rm -f "${xui_rc_temp}"
            _fail "ERROR: Downloaded startup unit xs-ui.rc is empty, please be sure that your server can access GitHub"
        fi
        mv -f "${xui_rc_temp}" /etc/init.d/xs-ui
        if [[ $? -ne 0 ]]; then
            rm -f "${xui_rc_temp}"
            _fail "ERROR: Failed to install startup unit xs-ui.rc"
        fi
        chmod +x /etc/init.d/xs-ui > /dev/null 2>&1
        chown root:root /etc/init.d/xs-ui > /dev/null 2>&1
        rc-update add xs-ui > /dev/null 2>&1
        rc-service xs-ui start > /dev/null 2>&1
    else
        if [ -f "xs-ui.service" ]; then
            echo -e "${green}Installing systemd unit...${plain}"
            if ! _install_xui_service_unit "xs-ui.service" "false"; then
                echo -e "${red}Failed to copy xs-ui.service${plain}"
                exit 1
            fi
        else
            service_installed=false
            case "${release}" in
                ubuntu | debian | armbian)
                    if [ -f "xs-ui.service.debian" ]; then
                        echo -e "${green}Installing debian-like systemd unit...${plain}"
                        if _install_xui_service_unit "xs-ui.service.debian" "false"; then
                            service_installed=true
                        fi
                    fi
                    ;;
                arch | manjaro | parch)
                    if [ -f "xs-ui.service.arch" ]; then
                        echo -e "${green}Installing arch-like systemd unit...${plain}"
                        if _install_xui_service_unit "xs-ui.service.arch" "false"; then
                            service_installed=true
                        fi
                    fi
                    ;;
                *)
                    if [ -f "xs-ui.service.rhel" ]; then
                        echo -e "${green}Installing rhel-like systemd unit...${plain}"
                        if _install_xui_service_unit "xs-ui.service.rhel" "false"; then
                            service_installed=true
                        fi
                    fi
                    ;;
            esac

            # If service file not found in tar.gz, download from GitHub
            if [ "$service_installed" = false ]; then
                echo -e "${yellow}Service files not found in tar.gz, downloading from GitHub...${plain}"
                case "${release}" in
                    ubuntu | debian | armbian)
                        service_unit_url="https://raw.githubusercontent.com/jaseyou/xs-ui/${script_ref}/xs-ui.service.debian"
                        ;;
                    arch | manjaro | parch)
                        service_unit_url="https://raw.githubusercontent.com/jaseyou/xs-ui/${script_ref}/xs-ui.service.arch"
                        ;;
                    *)
                        service_unit_url="https://raw.githubusercontent.com/jaseyou/xs-ui/${script_ref}/xs-ui.service.rhel"
                        ;;
                esac

                if ! _install_xui_service_unit "$service_unit_url" "true"; then
                    echo -e "${red}Failed to install xs-ui.service from GitHub (${script_ref}) -- the release tarball did not ship one either${plain}"
                    exit 1
                fi
            fi
        fi
        chown root:root ${xui_service}/xs-ui.service > /dev/null 2>&1
        chmod 644 ${xui_service}/xs-ui.service > /dev/null 2>&1
        systemctl daemon-reload > /dev/null 2>&1
        systemctl enable xs-ui > /dev/null 2>&1
        systemctl start xs-ui > /dev/null 2>&1
    fi

    config_after_update

    # IP Limit relies on fail2ban; install + configure it now so the feature
    # works out of the box on update too (no-op when XUI_ENABLE_FAIL2BAN=false).
    # Never fatal.
    setup_fail2ban

    echo -e "${green}xs-ui ${tag_version}${plain} updating finished, it is running now..."
    echo -e ""
    echo -e "┌───────────────────────────────────────────────────────┐
│  ${blue}xs-ui control menu usages (subcommands):${plain}              │
│                                                       │
│  ${blue}xs-ui${plain}              - Admin Management Script          │
│  ${blue}xs-ui start${plain}        - Start                            │
│  ${blue}xs-ui stop${plain}         - Stop                             │
│  ${blue}xs-ui restart${plain}      - Restart                          │
│  ${blue}xs-ui status${plain}       - Current Status                   │
│  ${blue}xs-ui settings${plain}     - Current Settings                 │
│  ${blue}xs-ui enable${plain}       - Enable Autostart on OS Startup   │
│  ${blue}xs-ui disable${plain}      - Disable Autostart on OS Startup  │
│  ${blue}xs-ui log${plain}          - Check logs                       │
│  ${blue}xs-ui banlog${plain}       - Check Fail2ban ban logs          │
│  ${blue}xs-ui update${plain}       - Update                           │
│  ${blue}xs-ui legacy${plain}       - Legacy version                   │
│  ${blue}xs-ui install${plain}      - Install                          │
│  ${blue}xs-ui uninstall${plain}    - Uninstall                        │
└───────────────────────────────────────────────────────┘"
}

echo -e "${green}Running...${plain}"
require_writable_update_paths
install_base
update_xs-ui $1
