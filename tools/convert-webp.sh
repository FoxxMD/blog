#!/bin/bash

# Converts any file to webp
#
# Depends on webp installed in devcontainer
#
# See: https://docs.digitalden.cloud/posts/create-fast-loading-images-with-lqip-webp-in-your-jekyll-chirpy-site/

cwebp "$1" -o "$2"
