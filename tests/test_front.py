import asyncio
import importlib.util
import os
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('front', Path(__file__).parents[1] / 'mcp/front.py')
front = importlib.util.module_from_spec(spec)
spec.loader.exec_module(front)


class FrontTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.calls = []
        self.bodies = []
        self.connections = []

        async def upstream(r, w):
            self.connections.append(w)
            head = await r.readuntil(b'\r\n\r\n')
            self.calls.append(head)
            headers = head.decode('latin-1').split('\r\n')
            length = next((int(h.split(':', 1)[1]) for h in headers if h.lower().startswith('content-length:')), 0)
            self.bodies.append(await r.readexactly(length) if length else b'')
            w.write(b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\n{}')
            await w.drain()
            # Deliberately keep Chrome's connection alive; the front must close it.
            await r.read()
            w.close()

        self.up = await asyncio.start_server(upstream, '127.0.0.1', 0)
        self.port = self.up.sockets[0].getsockname()[1]
        front.UP_HOST = '127.0.0.1'
        front.UP_PORT = self.port
        self.env = patch.dict(os.environ, {'READER_HOST': '127.0.0.1', 'READER_PORT': str(self.port)})
        self.env.start()
        self.server = await asyncio.start_server(front.handle, '127.0.0.1', 0)
        self.front_port = self.server.sockets[0].getsockname()[1]

    async def asyncTearDown(self):
        self.env.stop()
        for s in (self.server, self.up):
            s.close()
            await s.wait_closed()
        for w in self.connections:
            w.close()

    async def request(self, path, method='GET', headers='', body=b''):
        r, w = await asyncio.open_connection('127.0.0.1', self.front_port)
        w.write((f'{method} {path} HTTP/1.1\r\nHost: browser\r\nContent-Length: {len(body)}\r\n{headers}\r\n').encode() + body)
        await w.drain()
        result = await asyncio.wait_for(r.read(), 2)
        w.close()
        return result

    async def test_reader_public_and_agent_private(self):
        for path in ('/', '/app.js', '/api/reader?url=https://example.com'):
            self.assertIn(b' 200 ', await self.request(path, headers='X-Forwarded-For: 100.64.1.1\r\n'))
        for path in ('/mcp', '/json/version', '/json/new?https://example.com', '/devtools/browser/test'):
            self.assertIn(b' 403 ', await self.request(path, headers='X-Forwarded-For: 100.64.1.1\r\n'))
        self.assertEqual(len(self.calls), 3)

    async def test_all_proxy_identity_headers_refuse_mcp_and_devtools(self):
        for header in ('X-Forwarded-Surprise: value', 'Tailscale-User-Login: owner', 'Tailscale-User-Custom: value', 'Forwarded: for=100.64.1.1', 'Via: 1.1 proxy'):
            for path in ('/mcp', '/json/version', '/devtools/browser/test'):
                with self.subTest(header=header, path=path):
                    self.assertIn(b' 403 ', await self.request(path, headers=header + '\r\n'))
        self.assertEqual(len(self.calls), 0)

    async def test_direct_mcp_protocol_and_devtools_stay_available(self):
        self.assertIn(b' 200 ', await self.request('/json/version'))
        result = await self.request('/mcp', 'POST', 'Content-Type: application/json\r\n', b'{"jsonrpc":"2.0","id":1,"method":"ping"}')
        self.assertIn(b'"result": {}', result)

    async def test_reader_refuses_upgrade_and_request_body(self):
        self.assertIn(b' 405 ', await self.request('/', headers='Upgrade: websocket\r\n'))
        self.assertIn(b' 405 ', await self.request('/api/reader', 'POST', body=b'{}'))
        self.assertEqual(len(self.calls), 0)

    async def test_list_method_allowlist_and_body_forwarding(self):
        identity = 'X-Forwarded-For: 100.64.1.1\r\nContent-Type: application/json\r\n'
        row = '/api/list/12345678-1234-1234-1234-123456789abc'
        for path, method, body in [('/api/list', 'GET', b''), ('/api/list', 'POST', b'{"url":"https://example.com"}'), (row, 'PATCH', b'{"read":true}'), (row, 'DELETE', b'{}')]:
            self.assertIn(b' 200 ', await self.request(path, method, identity, body))
            self.assertEqual(self.bodies[-1], body)
        count = len(self.calls)
        for path, method in [('/api/list', 'PUT'), (row, 'POST'), ('/api/list/../mcp', 'POST'), ('/mcp', 'POST'), ('/json/version', 'PATCH'), ('/devtools/test', 'DELETE')]:
            self.assertRegex(await self.request(path, method, identity, b'{}'), b' (403|405) ')
        self.assertEqual(len(self.calls), count)
        self.assertIn(b' 413 ', await self.request('/api/list', 'POST', identity, b'x' * 16385))
        self.assertIn(b' 405 ', await self.request('/api/list', 'POST', identity + 'Transfer-Encoding: chunked\r\n', b'{}'))
        self.assertIn(b' 400 ', await self.request('/api/list', 'POST', identity + 'Content-Length: 2\r\n', b'{}'))

    async def test_keepalive_cannot_smuggle_second_mcp_request(self):
        r, w = await asyncio.open_connection('127.0.0.1', self.front_port)
        w.write(b'GET /json/version HTTP/1.1\r\nHost: browser\r\n\r\nGET /mcp HTTP/1.1\r\nHost: browser\r\nX-Forwarded-For: 1.1.1.1\r\n\r\n')
        await w.drain()
        response = await asyncio.wait_for(r.read(), 2)
        self.assertIn(b'Connection: close', response)
        self.assertEqual(len(self.calls), 1)
        self.assertNotIn(b'/mcp', self.calls[0])
        w.close()

if __name__ == '__main__':
    unittest.main()
