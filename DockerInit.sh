#!/bin/sh
set -e
# $1 is Docker's TARGETARCH and $2 its TARGETVARIANT (v6/v7 on arm). The
# platform names match the release archives and the mtg-multi packages.
case $1 in
    amd64 | "")
        PLATFORM="amd64"
        ;;
    arm64 | armv8 | aarch64)
        PLATFORM="arm64"
        ;;
    arm | arm32 | armv7)
        PLATFORM="armv7"
        if [ "$2" = "v6" ]; then
            PLATFORM="armv6"
        fi
        ;;
    armv6)
        PLATFORM="armv6"
        ;;
    386 | i386)
        PLATFORM="386"
        ;;
    *)
        echo "DockerInit: unsupported architecture '$1'" >&2
        exit 1
        ;;
esac
case $PLATFORM in
    amd64) XRAY_ZIP="64" ;;
    arm64) XRAY_ZIP="arm64-v8a" ;;
    armv7) XRAY_ZIP="arm32-v7a" ;;
    armv6) XRAY_ZIP="arm32-v6" ;;
    386) XRAY_ZIP="32" ;;
esac
# The panel looks binaries up by GOARCH; on arm Xray's is "arm32"
# (internal/xray/process.go) and mtg's plain "arm", as install.sh renames them.
case $PLATFORM in
    armv7 | armv6)
        XRAY_BIN="xray-linux-arm32"
        MTG_BIN="mtg-linux-arm"
        ;;
    *)
        XRAY_BIN="xray-linux-${PLATFORM}"
        MTG_BIN="mtg-linux-${PLATFORM}"
        ;;
esac
# Pinned: floating "latest" downloads are a supply-chain risk (audit #3).
MTG_MULTI_VER="v1.16.1"
if [ -z "$MTG_MULTI_VER" ]; then
    echo "DockerInit: could not resolve the latest mtg-multi release tag" >&2
    exit 1
fi
mkdir -p build/bin
cd build/bin
curl -sfLRO "https://github.com/XTLS/Xray-core/releases/download/v26.10.21/Xray-linux-${XRAY_ZIP}.zip"
unzip "Xray-linux-${XRAY_ZIP}.zip"
rm -f "Xray-linux-${XRAY_ZIP}.zip" geoip.dat geosite.dat
mv xray "${XRAY_BIN}"
# mtg-multi (MTProto sidecar) ships prebuilt release binaries for every target
# we package, so download and unpack the matching one instead of compiling.
MTG_PKG="mtg-multi-${MTG_MULTI_VER#v}-linux-${PLATFORM}"
curl -sfLRO "https://github.com/mhsanaei/mtg-multi/releases/download/${MTG_MULTI_VER}/${MTG_PKG}.tar.gz"
tar -xzf "${MTG_PKG}.tar.gz"
mv "${MTG_PKG}/mtg-multi" "${MTG_BIN}"
rm -rf "${MTG_PKG}" "${MTG_PKG}.tar.gz"
chmod +x "${MTG_BIN}"
# sing-box sidecar (anytls / shadowtls / naive templates). Optional dependency:
# skipped when upstream has no build for this platform; the panel runs without
# it and only the singbox-hosted templates are unavailable.
# Pinned to the version the panel is tested against (audit #3).
SINGBOX_VER="v1.14.4"
if [ -n "$SINGBOX_VER" ]; then
    SINGBOX_PKG="sing-box-${SINGBOX_VER#v}-linux-${PLATFORM}"
    if curl -sfLRO "https://github.com/SagerNet/sing-box/releases/download/${SINGBOX_VER}/${SINGBOX_PKG}.tar.gz"; then
        tar -xzf "${SINGBOX_PKG}.tar.gz"
        case $PLATFORM in
            armv7 | armv6) SINGBOX_BIN="sing-box-linux-arm32" ;;
            *) SINGBOX_BIN="sing-box-linux-${PLATFORM}" ;;
        esac
        mv "${SINGBOX_PKG}/sing-box" "${SINGBOX_BIN}"
        chmod +x "${SINGBOX_BIN}"
        rm -rf "${SINGBOX_PKG}" "${SINGBOX_PKG}.tar.gz"
    else
        echo "DockerInit: no sing-box linux-${PLATFORM} build; sidecar templates will be unavailable" >&2
        rm -f "${SINGBOX_PKG}.tar.gz"
    fi
else
    echo "DockerInit: could not resolve the latest sing-box release tag; skipping sidecar" >&2
fi
curl -sfLRO https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat
curl -sfLRO https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat
curl -sfLRo geoip_IR.dat https://github.com/chocolate4u/Iran-v2ray-rules/releases/latest/download/geoip.dat
curl -sfLRo geosite_IR.dat https://github.com/chocolate4u/Iran-v2ray-rules/releases/latest/download/geosite.dat
curl -sfLRo geoip_RU.dat https://github.com/runetfreedom/russia-v2ray-rules-dat/releases/latest/download/geoip.dat
curl -sfLRo geosite_RU.dat https://github.com/runetfreedom/russia-v2ray-rules-dat/releases/latest/download/geosite.dat
cd ../../
