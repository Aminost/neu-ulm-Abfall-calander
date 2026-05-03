const https = require('https');

https.get("https://nu.neu-ulm.de/securedl/sdl-eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NzU5MDY1ODUsImV4cCI6MTc3NTk1MzM4NSwidXNlciI6MCwiZ3JvdXBzIjpbMCwtMV0sImZpbGUiOiJmaWxlYWRtaW4vbW91bnQvc3RhZHQtbnUvcGRmcy8yX0J1ZXJnZXJfU2VydmljZS9NdWVsbF91bmRfU2F1YmVya2VpdC9BYmZhbGxrYWxlbmRlcl9OVV8yMDI2X0Jlemlyay01LmljcyIsInBhZ2UiOjEwODJ9.TGmXKpIf7UZ4XELKJO-7ZbQvzwQ4PVD0IDog3-EzHOU/Abfallkalender_NU_2026_Bezirk-5.ics", (res) => {
  let icsData = '';
  res.on('data', chunk => icsData += chunk);
  res.on('end', () => {
    console.log(icsData.substring(0, 500));
  });
});
