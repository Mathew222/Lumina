const https = require('https');

async function testTTS() {
    console.log("Testing Google TTS endpoints...");

    const text = "Hello world";
    const lang = "en";

    // Test cases
    const tests = [
        {
            name: "Standard with client=tw-ob",
            url: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`,
            headers: {}
        },
        {
            name: "Standard with client=gtx",
            url: `https://translate.googleapis.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=gtx`,
            headers: {}
        },
        {
            name: "tw-ob with Browser Headers",
            url: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://translate.google.com/'
            }
        },
        {
            name: "dict-chrome-ex",
            url: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=dict-chrome-ex`,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        }
    ];

    for (const t of tests) {
        console.log(`\n--- Testing: ${t.name} ---`);
        console.log(`URL: ${t.url}`);

        try {
            await new Promise((resolve, reject) => {
                const urlObj = new URL(t.url);
                const req = https.request({
                    hostname: urlObj.hostname,
                    path: urlObj.pathname + urlObj.search,
                    method: 'GET',
                    headers: t.headers
                }, (res) => {
                    console.log(`Status: ${res.statusCode}`);
                    if (res.statusCode === 200) {
                        console.log(`Success! Content-Type: ${res.headers['content-type']}`);
                    } else {
                        console.log(`Failed with status ${res.statusCode}`);
                    }
                    res.resume(); // consume response
                    resolve();
                });
                req.on('error', reject);
                req.end();
            });
        } catch (err) {
            console.error(`Error: ${err.message}`);
        }
    }
}

testTTS();
