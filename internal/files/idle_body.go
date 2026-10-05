package files

import (
	"io"
	"net/http"
	"time"
)

// An upload that sends nothing for this long is ended, so a stalled
// one gives its slot back.
const uploadIdle = 30 * time.Second

// idleBody is a request body whose every read must arrive within idle.
type idleBody struct {
	io.ReadCloser
	control *http.ResponseController
	idle    time.Duration
}

func (body idleBody) Read(buffer []byte) (int, error) {
	_ = body.control.SetReadDeadline(time.Now().Add(body.idle))
	return body.ReadCloser.Read(buffer)
}
