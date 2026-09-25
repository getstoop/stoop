
command -v docker >/dev/null || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "docker compose (v2) is not available"
[ -f docker-compose.yml ] || die "no docker-compose.yml here; run this from the install directory"
[ -f .env ] || die "no .env here; run this from the install directory"
current=$(tag_of docker-compose.yml)
[ -n "$current" ] || die "cannot read the stoop image tag from docker-compose.yml"
