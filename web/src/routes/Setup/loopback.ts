const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;

// A host only this machine can reach.
export const isLoopback = (host: string) => LOOPBACK.test(host);

export const onLoopback = () => isLoopback(window.location.hostname);
