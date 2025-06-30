const Busboy = require('busboy');
const fetch = require('node-fetch');

const IMGBB_API_KEY = "7a566f5e8bf791553a496e3c7c9e73c1";
const USERAPI_API_KEY = "76e6b884-9275-4b19-9ffc-71ec5a57dd69";
const USERAPI_ACCOUNT_HASH = "ed8e5870-34c1-4674-9c88-7af403a034e3";

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: event.headers });
    let imageBuffer = Buffer.alloc(0);
    let prompt = "";

    busboy.on('file', (fieldname, file) => {
      file.on('data', (data) => {
        imageBuffer = Buffer.concat([imageBuffer, data]);
      });
    });

    busboy.on('field', (fieldname, value) => {
      if (fieldname === "prompt") prompt = value;
    });

    busboy.on('finish', async () => {
      try {
        // Upload to ImgBB
        const base64Img = imageBuffer.toString('base64');
        const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
          method: 'POST',
          body: new URLSearchParams({ image: base64Img })
        });
        const imgbbJson = await imgbbRes.json();
        if (!imgbbJson.data || !imgbbJson.data.url) throw new Error("Image upload failed");

        // UserAPI V7 with omni_reference
        const userapiRes = await fetch("https://api.userapi.ai/discord/imagine", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": USERAPI_API_KEY },
          body: JSON.stringify({
            account_hash: USERAPI_ACCOUNT_HASH,
            prompt: `${imgbbJson.data.url} ${prompt}`,
            model: "midjourney-v7",
            omni_reference: true
          })
        });
        const userapiJson = await userapiRes.json();
        if (!userapiJson.hash) throw new Error("UserAPI imagine failed");

        // Poll for result
        let result = null;
        for (let tries = 0; tries < 14; tries++) {
          await new Promise(r => setTimeout(r, 5000));
          const pollRes = await fetch("https://api.userapi.ai/discord/fetch", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": USERAPI_API_KEY },
            body: JSON.stringify({
              account_hash: USERAPI_ACCOUNT_HASH,
              hash: userapiJson.hash
            })
          });
          const pollJson = await pollRes.json();
          if (pollJson.result && pollJson.result.url) {
            result = pollJson.result.url;
            break;
          }
        }

        if (!result) throw new Error("Timed out waiting for image");

        resolve({
          statusCode: 200,
          body: JSON.stringify({ success: true, result }),
          headers: { "Content-Type": "application/json" }
        });

      } catch (err) {
        resolve({
          statusCode: 200,
          body: JSON.stringify({ success: false, error: err.message }),
          headers: { "Content-Type": "application/json" }
        });
      }
    });

    busboy.end(Buffer.from(event.body, 'base64'));
  });
};
