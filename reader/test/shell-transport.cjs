// Preserve the browser's authority across the isolated QA reverse proxy.
// Node fetch (Undici) replaces an explicit Host with the upstream authority.
// Never fix that mismatch by changing Origin or relaxing the app's CSRF guard.
const http = require('node:http');
function proxyRequest(url, {method='GET', headers={}, body}={}) {
  headers={...headers};
  if(body!==undefined && body!==null){
    delete headers['transfer-encoding'];
    headers['content-length']=String(Buffer.byteLength(body));
  }
  return new Promise((resolve,reject)=>{
    const request=http.request(url,{method,headers},response=>{
      const chunks=[];
      response.on('data',chunk=>chunks.push(chunk));
      response.on('error',reject);
      response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));
    });
    request.on('error',reject);
    request.setTimeout(65000,()=>request.destroy(Error('QA upstream timed out')));
    request.end(body);
  });
}
module.exports={proxyRequest};
