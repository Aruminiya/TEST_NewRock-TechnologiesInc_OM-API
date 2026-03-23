import http from 'http';

const MONITOR_PORT = 4022;

const eventServer = http.createServer((req, res) => {
  // OM API 推送通常使用 GET 或 POST [cite: 120]
  let body = '';
  
  req.on('data', chunk => { body += chunk; });
  
  req.on('end', () => {
    // 1. 立即回應 200 OK 給 OM 並關閉連接 [cite: 77, 121]
    // 這對 HTTP 1.0 設備非常重要，能防止設備因等待回應而掛起
    res.writeHead(200, { 'Connection': 'close', 'Content-Type': 'text/plain' });
    res.end();

    if (!body) return;

    // 2. 解析事件類型 (實務上建議使用 fast-xml-parser 庫)
    console.log(`\n[${new Date().toLocaleTimeString()}] 收到 OM 事件:`);
    
    // 響鈴監控 [cite: 1494, 1500]
    if (body.includes('attribute="RING"')) {
      const ext = body.match(/id="(\d+)"/)?.[1];
      console.log(`🔔 響鈴中: 分機 ${ext}`);
    } 
    // 接聽監控 [cite: 1554, 1559]
    else if (body.includes('attribute="ANSWER"')) {
      console.log('✅ 結果: 電話已接聽');
    } 
    // 掛斷監控 [cite: 1584, 1589]
    else if (body.includes('attribute="BYE"')) {
      console.log('❌ 結果: 電話已掛斷');
    }
    // 通話紀錄報告 [cite: 1784, 1806]
    else if (body.includes('<Cdr')) {
      const duration = body.match(/<Duration>(\d+)<\/Duration>/)?.[1];
      console.log(`📊 通話結束紀錄: 談話時長 ${duration} 秒`);
    }
  });
});

eventServer.listen(MONITOR_PORT, () => {
  console.log(`🚀 監聽伺服器啟動於 Port ${MONITOR_PORT}，請確保 OM 後台 Server 填寫 192.168.8.62:${MONITOR_PORT}`);
});