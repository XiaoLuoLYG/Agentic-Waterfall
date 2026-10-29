"""Expose the official target-masked interaction tools to the local Waterfall bridge."""
import argparse, json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def create_server(tool,port):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            try:
                size=int(self.headers.get('Content-Length','0'))
                if not 0<size<=65536:raise ValueError('invalid request size')
                request=json.loads(self.rfile.read(size));name=request['tool'];args=request['arguments']
                if name not in ('get_user','get_item','get_reviews') or not isinstance(args,dict):raise ValueError('invalid tool request')
                response={'result':getattr(tool,name)(**args)};status=200
            except Exception as error:
                response={'error':type(error).__name__};status=400
            body=json.dumps(response,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def log_message(self,*args):pass
    return ThreadingHTTPServer(('127.0.0.1',port),Handler)

if __name__=='__main__':
    from official_components import load_components
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--data-dir',required=True);p.add_argument('--task-dir',required=True);p.add_argument('--port',type=int,default=0);a=p.parse_args()
    tool=load_components().InteractionTool(a.data_dir,a.task_dir)
    server=create_server(tool,a.port);print(json.dumps({'port':server.server_port}),flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
