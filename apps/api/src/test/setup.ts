import http from 'node:http';

// Node ≥19's global agent keeps sockets alive. supertest starts and closes an ephemeral server per
// request, so a pooled socket can point at a server that just closed (a reused port under load) and
// the next request fails with "socket hang up". Tests open a fresh connection every time.
http.globalAgent = new http.Agent({ keepAlive: false });
