
plan=no
yes=no
to=
file=
command=upgrade
while [ $# -gt 0 ]; do
	case "$1" in
	--plan) plan=yes ;;
	--yes | -y) yes=yes ;;
	--to) [ $# -ge 2 ] || usage; to=$2; shift ;;
	--file) [ $# -ge 2 ] || usage; file=$2; shift ;;
	rollback) command=rollback ;;
	-h | --help) usage ;;
	*) usage ;;
	esac
	shift
done
