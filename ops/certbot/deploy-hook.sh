#!/bin/sh
set -eu

docker exec investment-nginx nginx -t
exec docker exec investment-nginx nginx -s reload
