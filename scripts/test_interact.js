const http = require('http');

// Let's test the concept by checking if profile_001 is running
const req = http.request({
  hostname: '127.0.0.1',
  port: 4000,
  path: '/api/profiles/profile_001/page-info',
  method: 'GET'
}, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Page info:', data));
});
req.end();
