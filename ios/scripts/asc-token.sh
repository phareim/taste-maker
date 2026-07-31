#!/usr/bin/env bash
# Mint an App Store Connect API JWT (ES256) using only openssl.
#
# Deliberately dependency-free. The obvious implementations need PyJWT and
# cryptography, which is a lot of Python to add to a Nuxt repo for one HTTP
# header — and every CI box already has openssl.
#
#   ASC_KEY_ID=... ASC_ISSUER_ID=... ./scripts/asc-token.sh
#
# Reads the key from ~/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8,
# the same place altool looks.

set -euo pipefail

: "${ASC_KEY_ID:?set ASC_KEY_ID}"
: "${ASC_ISSUER_ID:?set ASC_ISSUER_ID}"

KEY_FILE="${ASC_KEY_FILE:-$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8}"
[ -f "$KEY_FILE" ] || { echo "no key at $KEY_FILE" >&2; exit 1; }

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

now=$(date +%s)
header=$(printf '{"alg":"ES256","kid":"%s","typ":"JWT"}' "$ASC_KEY_ID" | b64url)
payload=$(printf '{"iss":"%s","iat":%d,"exp":%d,"aud":"appstoreconnect-v1"}' \
  "$ASC_ISSUER_ID" "$now" "$((now + 1200))" | b64url)
signing_input="${header}.${payload}"

# openssl emits a DER-encoded ECDSA signature: SEQUENCE { INTEGER r, INTEGER s }.
# JWS wants the raw 64 bytes r||s, each left-padded to 32. DER drops leading
# zero bytes and adds one when the high bit is set, so r and s must be
# re-padded individually rather than just concatenated.
der=$(printf '%s' "$signing_input" | openssl dgst -sha256 -sign "$KEY_FILE" | xxd -p | tr -d '\n')

parse_int() { # $1 = hex, $2 = byte offset of the INTEGER tag -> prints hex value
  local hex=$1 off=$2 len
  [ "${hex:$((off * 2)):2}" = "02" ] || { echo "unexpected DER at byte $off" >&2; exit 1; }
  len=$((16#${hex:$(((off + 1) * 2)):2}))
  echo "${hex:$(((off + 2) * 2)):$((len * 2))} $len"
}

[ "${der:0:2}" = "30" ] || { echo "unexpected DER header" >&2; exit 1; }
# A SEQUENCE longer than 127 bytes uses a length prefix; P-256 sigs never are.
r_out=$(parse_int "$der" 2); r_hex=${r_out% *}; r_len=${r_out#* }
s_out=$(parse_int "$der" $((4 + r_len))); s_hex=${s_out% *}

pad32() { # strip DER's leading zero / left-pad to 32 bytes
  local h=$1
  while [ ${#h} -gt 64 ] && [ "${h:0:2}" = "00" ]; do h=${h:2}; done
  while [ ${#h} -lt 64 ]; do h="00$h"; done
  echo "$h"
}

sig=$(printf '%s%s' "$(pad32 "$r_hex")" "$(pad32 "$s_hex")" | xxd -r -p | b64url)
echo "${signing_input}.${sig}"
