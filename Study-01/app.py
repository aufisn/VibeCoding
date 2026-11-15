"""Draw digits or letters with your mouse/finger and see live predictions.

Usage: python app.py   then open http://localhost:8000
"""
import base64
import io
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

from PIL import Image

from predict import Recognizer

rec = Recognizer()

PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>Handwriting Recognizer</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 body{font-family:system-ui,sans-serif;background:#f4f4f5;color:#18181b;display:flex;flex-direction:column;align-items:center;margin:0;padding:24px 16px}
 h1{font-size:22px;margin:0 0 4px} p{color:#52525b;margin:0 0 14px}
 .modes{display:flex;gap:0;margin-bottom:16px;border:1px solid #d4d4d8;border-radius:10px;overflow:hidden;background:#fff}
 .modes button{border:0;background:none;padding:8px 18px;font-size:15px;cursor:pointer;color:#3f3f46}
 .modes button.on{background:#18181b;color:#fff}
 .wrap{display:flex;gap:28px;flex-wrap:wrap;justify-content:center}
 canvas{background:#fff;border:2px solid #d4d4d8;border-radius:12px;touch-action:none;cursor:crosshair;width:280px;height:280px}
 #guess{font-size:96px;font-weight:700;line-height:1;text-align:center;min-height:100px}
 #kind{text-align:center;color:#71717a;font-size:13px;min-height:18px;margin-bottom:10px}
 .bar{display:flex;align-items:center;gap:8px;font-size:15px;margin:4px 0;font-variant-numeric:tabular-nums}
 .bar b{width:18px;text-align:center}
 .bar div{height:12px;background:#2563eb;border-radius:3px;transition:width .15s}
 .clear{margin-top:12px;padding:8px 20px;font-size:15px;border:0;border-radius:8px;background:#18181b;color:#fff;cursor:pointer}
 #err{color:#b91c1c;font-size:14px;min-height:18px;margin-top:8px}
</style></head><body>
<h1>Handwriting Recognizer</h1><p>Draw one character in the box</p>
<div class="modes">
 <button data-m="digits" class="on">Digits 0-9</button><button data-m="letters">Letters A-z</button><button data-m="all">All</button>
</div>
<div class="wrap">
 <div style="text-align:center"><canvas id="c" width="280" height="280"></canvas><br><button class="clear" id="clear">Clear</button><div id="err"></div></div>
 <div style="width:230px"><div id="guess">?</div><div id="kind"></div><div id="bars"></div></div>
</div>
<script>
const c=document.getElementById('c'),x=c.getContext('2d');let mode='digits',drawn=false;
const $=id=>document.getElementById(id);
function clear(){x.fillStyle='#fff';x.fillRect(0,0,280,280);drawn=false;$('guess').textContent='?';$('kind').textContent='';$('bars').innerHTML='';$('err').textContent=''}
x.lineWidth=18;x.lineCap='round';x.lineJoin='round';x.strokeStyle='#000';
let down=false,timer;
const pos=e=>{const r=c.getBoundingClientRect();return[(e.clientX-r.left)*280/r.width,(e.clientY-r.top)*280/r.height]};
c.onpointerdown=e=>{down=drawn=true;c.setPointerCapture(e.pointerId);x.beginPath();x.moveTo(...pos(e));x.lineTo(...pos(e));x.stroke()};
c.onpointermove=e=>{if(!down)return;x.lineTo(...pos(e));x.stroke();clearTimeout(timer);timer=setTimeout(send,120)};
c.onpointerup=()=>{down=false;send()};
const kind=ch=>/[0-9]/.test(ch)?'digit':ch===ch.toUpperCase()?'CAPITAL letter':'small letter';
async function send(){if(!drawn)return;
 const r=await fetch('/predict?mode='+mode,{method:'POST',body:c.toDataURL('image/png')});const d=await r.json();
 if(d.error){$('err').textContent=d.error;return}$('err').textContent='';
 const top=d.top;$('guess').textContent=top[0][0];$('kind').textContent=kind(top[0][0]);
 $('bars').innerHTML=top.slice(0,6).map(([ch,p])=>`<div class="bar"><b>${ch}</b><div style="width:${p*140}px"></div>${(p*100).toFixed(1)}%</div>`).join('')}
document.querySelectorAll('.modes button').forEach(b=>b.onclick=()=>{
 document.querySelectorAll('.modes button').forEach(o=>o.classList.toggle('on',o===b));mode=b.dataset.m;send()});
$('clear').onclick=clear;clear();
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self._send(200, "text/html", PAGE.encode())

    def do_POST(self):
        mode = self.path.partition("mode=")[2] or "digits"
        data = self.rfile.read(int(self.headers["Content-Length"])).decode()
        try:
            img = Image.open(io.BytesIO(base64.b64decode(data.split(",", 1)[1])))
            body = {"top": rec.predict(img, mode)[:6]}
        except ValueError as e:
            body = {"error": str(e)}
        self._send(200, "application/json", json.dumps(body).encode())

    def _send(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print("Open http://localhost:8000 and draw a character (Ctrl+C to stop)")
    HTTPServer(("localhost", 8000), Handler).serve_forever()
