const baud = 115200;

class HTTPort {
  reader = false;
  writer = false;
  port = false;
  bytesTransferred = 0;

  setPort(port) {
    this.port = port;
  }

  async connect() {
    await this.port.open({ baudRate: baud });
    console.log(`Connected @ ${baud} baud`, "sys");
  }

  async disconnect() {
    if (this.reader) {
      await this.reader.cancel().catch(console.warn);
      this.reader.releaseLock();
      this.reader = null;
    }
    if (this.writer) {
      await this.writer.close().catch(console.warn);
      this.writer.releaseLock();
      this.writer = null;
    }
    if (this.readPipe) {
      await this.readPipe.catch(console.warn);
      this.readPipe = null;
    }
    if (this.writePipe) {
      await this.writePipe.catch(console.warn);
      this.writePipe = null;
    }

    await this.port.close();
  }

  async write(text) {
    console.log(">", text.trim());
    try {
      if (!this.writer) {
        const enc = new TextEncoderStream();
        this.writePipe = enc.readable.pipeTo(this.port.writable);
        this.writer = enc.writable.getWriter();
      }
      await this.writer.write(text + "\n\n");
    } catch (e) {
      console.log("Send error: " + e.message, "err");
    }
  }

  async _updateLog(body) {
    this.bytesTransferred += body.length;
    let byteMsg = "";
    const b = 1024;
    const kb = 1024 * 1024;
    const mb = 1024 * 1024 * 1024;
    if (this.bytesTransferred < b) {
      byteMsg = `${this.bytesTransferred}b`;
    } else if (this.bytesTransferred < kb) {
      byteMsg = `${(this.bytesTransferred / b).toFixed(1)}kb`;
    } else if (this.bytesTransferred < mb) {
      byteMsg = `${(this.bytesTransferred / kb).toFixed(1)}mb`;
    }
    document.querySelector("#bar-bytes-transferred").innerText = byteMsg;
  }

  prepareNextResponse() {
    this.nextResponse = new Promise((resolve, reject) => {
      this._resolveNextResponse = resolve;
      this._rejectNextResponse = reject;
    });
    this.nextResponse.then(this._updateLog.bind(this));
  }

  async stream() {
    const decoder = new TextDecoderStream();
    this.readPipe = this.port.readable.pipeTo(decoder.writable);
    this.reader = decoder.readable.getReader();


    this.prepareNextResponse();

    let status,
        headers,
        headerOffset = 0,
        buf = "";

    while (true) {
      const { value, done } = await this.reader.read();
      if (done) {
        console.log("Stream reported done.");
        break;
      }
      buf += value;

      const chunks = buf.split(/\r\n\r\n/);

      if (chunks.length === 2) {
        if (!headerOffset) {
          // console.log("setting header offset");
          const protocolLines = chunks[0].split("\n");
          status = protocolLines[0];
          headers = parseHeaders(protocolLines.slice(1).join("\n"))
          headerOffset = chunks[0].length + 4; // Plus 4 for \r\n\r\n
        }

        if (headerOffset) {
          const body = buf.slice(headerOffset);
          const bodyLength = new TextEncoder().encode(body).length;
          const contentLength = parseInt(headers["content-length"], 10);
          const newlineCount = (body.match(new RegExp("\r\n", "gi")) || []).length;

          if (bodyLength-newlineCount === contentLength) {
            // console.log(status, headers, body);
            console.log(`[${status} ${body.length} bytes]`);
            this._resolveNextResponse(body.trim());

            buf = "";
            status = undefined;
            headers = undefined;
            headerOffset = 0;
          }
        }
      }
    }

    console.log("Stream closed.");
  }

  route(method, path) {
    httport.prepareNextResponse();
    this.write(`${method} ${path}`);
    return this.nextResponse;
  }
}

window.httport = new HTTPort();

async function timer(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Operation timed out after ${ms}ms`));
    }, ms);
  });
}

function loadToContainer(body) {
  const bodyContainer = document.getElementById("body-container");
  bodyContainer.innerHTML = body;

  // Activate inert scripts
  bodyContainer.querySelectorAll('script').forEach(oldScript => {
    const newScript = document.createElement('script');
    for (const attr of oldScript.attributes) {
      newScript.setAttribute(attr.name, attr.value);
    }

    newScript.textContent = oldScript.textContent;
    oldScript.replaceWith(newScript);
  });
}

async function watch() {
  const ports = await navigator.serial.getPorts();

  if (ports.length > 0) {
    console.log("Port attached");
    console.log(ports);

    for (let portIndex in ports) {
      console.log(`Trying port ${portIndex}`);
      try {
        httport.setPort(ports[portIndex]);
        await httport.connect();
      } catch (e) {
        console.log(`${e} on ${portIndex}`);
      }

      const stream = httport.stream();

      let ok;
      ok = await Promise.race([
        httport.route("GET", "/_/heartbeat"),
        timer(100),
      ]).catch((e) => {
        console.log(e);
      });

      if (ok === "Ok!") {
        console.log("Okayed!");

        stream.catch((e) => {
          console.warn(e);
          console.log("Stream catch, device disconnected?");
          setTimeout(watch, 1000);
        });

        route();

        break;
      } else {
        console.log("Okay failed, disconnect.");
      }
    }
  } else {
    console.log("No ports found, trying again in 1s");
    setTimeout(watch, 1000);
  }
}

route = () => {
  if (document.location.hash === "") {
    document.location.hash = "/";
  } else {
    httport.route("GET", document.location.hash.slice(1)).then(loadToContainer);
  }
};
addEventListener("hashchange", route)

watch();

const registerServiceWorker = async () => {
  if (!("serviceWorker" in navigator)) {
    console.warn("No service worker support.");
    return;
  }

  const sw = navigator.serviceWorker;

  sw.addEventListener("message", async (event) => {
    const pathname = new URL(event.data.url).pathname;
    // const body = await event.data.body.text();
    httport.route(event.data.method, pathname).then((body) => {
      event.target.controller.postMessage({
        url: event.data.url,
        body,
      });
    });
  });

  const registration = await sw.register("/sw.js", {
    scope: "/",
  });

  if (registration.installing) {
    console.log("Service worker installing");
  } else if (registration.waiting) {
    console.log("Service worker installed");
  } else if (registration.active) {
    console.log("Service worker active");
  }
};

registerServiceWorker();

async function pair() {
  await navigator.serial.requestPort({
    filters: [
      {
        usbVendorId: 0x2e8a,
      },
    ],
  });
}

function parseHeaders(rawHeaders) {
  const headersObject = {};
  if (!rawHeaders) return headersObject;

  // Split lines by carriage return and newline
  const lines = rawHeaders.trim().split(/\r?\n/);

  for (const line of lines) {
    const index = line.indexOf(":");
    if (index === -1) continue;

    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();

    if (headersObject[key]) {
      headersObject[key] = Array.isArray(headersObject[key])
        ? [...headersObject[key], value]
        : [headersObject[key], value];
    } else {
      headersObject[key] = value;
    }
  }

  return headersObject;
}
