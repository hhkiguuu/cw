import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 8080;

// 🔴 PUT YOUR PASTEBIN RAW LINK HERE
const PASTEBIN_RAW = "https://pastebin.com/raw/0vthSiFf";

app.get("/", (req, res) => {
  res.send("key system active");
});

app.get("/loader", async (req, res) => {
  try {
    const response = await fetch(PASTEBIN_RAW);

    if (!response.ok) {
      return res.status(500).send("-- Failed to fetch script");
    }

    const originalScript = await response.text();

    // Convert script to hex
    const hexEncoded = Buffer.from(originalScript, "utf8").toString("hex");

    // Obfuscated wrapper
    const wrappedScript = `
local function d(h)
    local s = ""
    for i = 1, #h, 2 do
        s = s .. string.char(tonumber(h:sub(i,i+1),16))
    end
    return s
end

local f = loadstring or load
f(d("${hexEncoded}"))()
`;

    res.setHeader("Content-Type", "text/plain");
    res.send(wrappedScript);

  } catch (error) {
    console.error("Loader error:", error);
    res.status(500).send("-- Loader internal error");
  }
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});