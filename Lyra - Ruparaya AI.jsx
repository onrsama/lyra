/**
 * Lyra - Ruparaya AI Generation - JSX UI (UTF-8 Safe)
 * v 1.0
 */

#target photoshop

// ===== CONFIGURATION =====
var CONFIG = {
    BACKEND_BASE: "https://ruparaya-dev.com/ai-api",
    MODELS: {
        // only Nano Banana is exposed in this UI; other models retained for future use
        "Nano-Banana (Gemini)": "google/nano-banana",
        "Flux Kontext Pro": "0f1178f5a27e9aa2d2d39c8a43c110f7fa7cbf64062ff04a04cd40899e546065",
        "Flux Kontext Max": "black-forest-labs/flux-kontext-max"
    },
    MAX_POLL_ATTEMPTS: 60,
    POLL_INTERVAL: 2,
    // use higher quality and larger max dimension to match Nano defaults
    JPEG_QUALITY: 10,
    MAX_DIMENSION: 2000,
    IS_WINDOWS: $.os.indexOf("Windows") !== -1
};

// ===== GLOBAL CANCEL FLAG =====
var PROCESS_CANCELLED = false;

// ===== UTF-8 UTIL =====
function setUtf8(f) {
    try {
        f.encoding = "UTF-8";
        f.lineFeed = "Unix";
    } catch(e){}
}

// === Scale reference image if needed (Windows-safe)
// This helper resizes a reference image before encoding it to base64.
// When passing isReference=true to encodeImageBase64, the file will be
// scaled using this function. Large images on Windows can cause
// unpredictable failures when piping through certutil, so we downscale
// the reference to a maximum dimension defined in CONFIG.MAX_DIMENSION.
function scaleReferenceImage(referenceFile) {
    var tempDoc = null;
    try {
        // File size in MB
        var fileSizeMB = (referenceFile.length / (1024 * 1024));
        // In Windows, force downscale for files >1MB to avoid certutil issues
        var forceScale = (CONFIG.IS_WINDOWS && fileSizeMB > 1);
        // Purge caches on very large files on Windows
        if (CONFIG.IS_WINDOWS && fileSizeMB > 5) {
            app.purge(PurgeTarget.ALLCACHES);
        }
        tempDoc = app.open(referenceFile);
        var width = tempDoc.width.value;
        var height = tempDoc.height.value;
        var maxDim = CONFIG.MAX_DIMENSION;
        var needsScaling = (width > maxDim || height > maxDim || forceScale);
        if (!needsScaling) {
            tempDoc.close(SaveOptions.DONOTSAVECHANGES);
            return null;
        }
        // For very large files on Windows, slightly reduce max dimension to 1900
        var effectiveMax = (CONFIG.IS_WINDOWS && fileSizeMB > 5) ? 1900 : maxDim;
        var scale = effectiveMax / Math.max(width, height);
        var newW = Math.round(width * scale);
        var newH = Math.round(height * scale);
        var resample = (CONFIG.IS_WINDOWS && fileSizeMB > 5) ? ResampleMethod.BICUBICSHARPER : ResampleMethod.BICUBIC;
        tempDoc.resizeImage(UnitValue(newW, "px"), UnitValue(newH, "px"), null, resample);
        // Save scaled file as JPEG in temp folder
        var out = new File(Folder.temp + "/scaled_ref_" + new Date().getTime() + ".jpg");
        var opt = new JPEGSaveOptions();
        opt.quality = CONFIG.JPEG_QUALITY;
        tempDoc.saveAs(out, opt, true, Extension.LOWERCASE);
        tempDoc.close(SaveOptions.DONOTSAVECHANGES);
        // Ensure file is flushed to disk
        if (CONFIG.IS_WINDOWS) $.sleep(500);
        return out;
    } catch (e) {
        try { if (tempDoc) tempDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
        return null;
    }
}

// =============================================== PS - WEB ===============================================
// ===== LOAD OR SAVE AUTH =====
function loadAuth() {
    try {
        var prefsFile = getPreferencesFile();
        if (!prefsFile.exists) return null;
        setUtf8(prefsFile);
        prefsFile.open("r");
        var txt = prefsFile.read(); 
        prefsFile.close();
        var nameMatch  = txt.match(/"name"\s*:\s*"([^"]+)"/);
        var tokenMatch = txt.match(/"token"\s*:\s*"([^"]+)"/);
        if (nameMatch && tokenMatch) {
            return { name: nameMatch[1], token: tokenMatch[1] };
        }
    } catch (e) {}
    return null;
}

function saveAuth(name, token) {
    try {
        var prefs = loadPreferences();
        var prefsFile = getPreferencesFile();
        setUtf8(prefsFile);
        prefsFile.open("w");
        var parts = [];
        if (prefs.apiKey) parts.push('"apiKey":"'+prefs.apiKey+'"');
        if (prefs.lastModel) parts.push('"lastModel":"'+prefs.lastModel+'"');
        parts.push('"name":"'+name.replace(/"/g,'\\"')+'"');
        parts.push('"token":"'+token.replace(/"/g,'\\"')+'"');
        prefsFile.write('{'+parts.join(',')+'}');
        prefsFile.close();
        return true;
    } catch(e) { 
        return false; 
    }
}

function clearAuth() {
    try {
        var prefsFile = getPreferencesFile();
        if (prefsFile.exists) {
            prefsFile.remove();
        }
    } catch(e){}
}

// ===== CLAIM KODE & NAMA DIALOG =====
function showClaimDialog() {
    var dlg = new Window("dialog", "Aktivasi Lyra - Ruparaya AI");
    dlg.orientation = "column"; 
    dlg.alignChildren = "fill"; 
    dlg.margins = 16; 
    dlg.spacing = 10;
    
    var g1 = dlg.add("group"); 
    g1.add("statictext", undefined, "Nama:"); 
    var nameInput = g1.add("edittext", undefined, ""); 
    nameInput.characters = 32;

    var g2 = dlg.add("group"); 
    g2.add("statictext", undefined, "Kode 20-karakter:");
    var codeInput = g2.add("edittext", undefined, ""); 
    codeInput.characters = 24;

    var g3 = dlg.add("group"); 
    var ok = g3.add("button", undefined, "Kirim"); 
    var cancel = g3.add("button", undefined, "Batal");
    
    ok.onClick = function(){ dlg.close(1); }; 
    cancel.onClick = function(){ dlg.close(0); };

    var r = dlg.show();
    if (r == 1) {
        return { name: nameInput.text, code: codeInput.text };
    }
    return null;
}

// ===== JSON STRINGIFY HELPER =====
function stringifyJSON(obj) {
    if (obj === null) return "null";
    if (typeof obj === "undefined") return "undefined";
    if (typeof obj === "string") return '"' + obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
    if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
    if (obj instanceof Array) {
        var items = [];
        for (var i = 0; i < obj.length; i++) {
            items.push(stringifyJSON(obj[i]));
        }
        return "[" + items.join(",") + "]";
    }
    if (typeof obj === "object") {
        var items = [];
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
                items.push(stringifyJSON(key) + ":" + stringifyJSON(obj[key]));
            }
        }
        return "{" + items.join(",") + "}";
    }
    return '""';
}

// ===== END POINT SERVER =====
function postJson(url, jsonObj) {
    // 1) tulis payload ke file sementara (UTF-8)
    var payloadFile = new File(Folder.temp + "/ps_payload_" + new Date().getTime() + ".json");
    setUtf8(payloadFile);
    payloadFile.open("w");
    payloadFile.write(stringifyJSON(jsonObj));
    payloadFile.close();

    // 2) file output dari curl (UTF-8 saat dibaca)
    var outFile = new File(Folder.temp + "/ps_out_" + new Date().getTime() + ".txt");
    setUtf8(outFile);

    // 3) tulis skrip sementara agar quoting aman (khusus Windows)
    var scriptFile = new File(Folder.temp + "/ps_post_" + new Date().getTime() + (CONFIG.IS_WINDOWS ? ".bat" : ".sh"));
    setUtf8(scriptFile);
    scriptFile.open("w");

    if (CONFIG.IS_WINDOWS) {
        var cmd = 'curl.exe -s --fail-with-body --connect-timeout 15 --ssl-no-revoke ' +
                  '-X POST -H "Content-Type: application/json; charset=utf-8" ' +
                  '--data-binary "@' + payloadFile.fsName + '" "' + url + '" ' +
                  '> "' + outFile.fsName + '" 2>&1';

        scriptFile.writeln('@echo off');
        scriptFile.writeln('chcp 65001>nul'); // UTF-8 console
        scriptFile.writeln(cmd);
    } else {
        scriptFile.writeln('#!/bin/bash');
        var sh = 'curl -s --fail-with-body --connect-timeout 15 ' +
                 '-X POST -H "Content-Type: application/json; charset=utf-8" ' +
                 '--data-binary "@' + payloadFile.fsName + '" "' + url + '" ' +
                 '> "' + outFile.fsName + '" 2>&1';
        scriptFile.writeln(sh);
    }
    scriptFile.close();

    // 4) eksekusi skrip
    if (CONFIG.IS_WINDOWS) {
        app.system('cmd.exe /c "' + scriptFile.fsName + '"');
    } else {
        app.system('chmod +x "' + scriptFile.fsName + '" && "' + scriptFile.fsName + '"');
    }

    // 5) baca hasil (as UTF-8)
    var content = null;
    if (outFile.exists) {
        setUtf8(outFile);
        outFile.open("r");
        content = outFile.read();
        outFile.close();
        try { outFile.remove(); } catch(e){}
    }

    // 6) bersih-bersih
    try { scriptFile.remove(); } catch(e){}
    try { payloadFile.remove(); } catch(e){}

    $.writeln("[HTTP] POST done to " + url + " | bytes=" + (content ? content.length : 0));
    return content; // bisa berisi JSON sukses ATAU pesan error curl/HTTP
}

// ===== VALIDATE IF HAVE TOKEN OR NOT =====
function ensureAuthOrPrompt() {
    // Coba muat token
    var auth = loadAuth();
    if (auth && auth.name && auth.token) {
        // verifikasi cepat
        var resp = postJson(CONFIG.BACKEND_BASE + "/verify.php", { name: auth.name, token: auth.token });
        if (resp && resp.indexOf('"ok":true') > -1) return auth;

        // kalau ditolak (diblock), hapus auth & lanjut ke klaim
        clearAuth();
    }
    
    // Minta klaim
    while (true) {
        var data = showClaimDialog();
        if (!data) return null; // user batal
        
        // (opsional) device_id random
        var deviceId = (new Date().getTime()).toString(16) + Math.floor(Math.random()*1e9).toString(16);
        var resp = postJson(CONFIG.BACKEND_BASE + "/issue-token.php", { 
            name: data.name, 
            code: data.code, 
            device_id: deviceId 
        });

        // DEBUG: tampilkan 200 karakter pertama respon
        alert("Server response:\n" + (resp ? resp.substring(0,200) : "(no response)"));

        if (resp && resp.indexOf('"ok":true') > -1) {
            var m = resp.match(/"token"\s*:\s*"([^"]+)"/);
            if (m) {
                saveAuth(data.name, m[1]);
                return { name: data.name, token: m[1] };
            }
        } else if (resp && resp.indexOf('already_used')>-1) {
            alert("Kode kamu sudah terpakai. Silakan hubungi admin.");
        } else if (resp && resp.indexOf('blocked')>-1) {
            alert("Kode kamu diblokir admin.");
        } else {
            alert("Aktivasi gagal. Periksa Nama/Kode.");
        }
    }
}

// =============================================== PS - WEB END ===============================================

// ===== PROGRESS WINDOW =====
function createProgressWindow(modelName) {
    PROCESS_CANCELLED = false;

    var win = new Window("palette", "Lyra - Ruparaya AI - Progress");
    win.orientation = "column";
    win.alignChildren = "fill";
    win.margins = 14;
    win.spacing  = 8;
    win.preferredSize.width = 380;

    // Header
    var head = win.add("group");
    head.alignment = ["fill","top"];
    var title = head.add("statictext", undefined, "Generating...", {multiline:false});
    title.graphics.font = ScriptUI.newFont(title.graphics.font.name, ScriptUI.FontStyle.BOLD, 12);

    // Status line (teks utama)
    win.statusText = win.add("statictext", undefined, "Preparing image...", {multiline:true});
    win.statusText.preferredSize.height = 38;

    // Progress bar
    win.pb = win.add("progressbar", undefined, 0, 100);
    win.pb.value = 2;

    // Tip
    var tip = win.add("statictext", undefined, "Please keep Photoshop focused until finished.", {multiline:true});
    tip.graphics.font = ScriptUI.newFont(tip.graphics.font.name, ScriptUI.FontStyle.ITALIC, 9);
    tip.preferredSize.height = 28;

    // Windows notice (opsional)
    if (CONFIG.IS_WINDOWS) {
        var sep = win.add("panel"); sep.preferredSize.height = 1;
        var note = win.add("statictext", undefined,
            "Windows may flash brief command windows - this is normal.", {multiline:true});
        note.graphics.font = ScriptUI.newFont(note.graphics.font.name, ScriptUI.FontStyle.ITALIC, 9);
        note.justify = "center";
        note.preferredSize.height = 30;
    }

    // Footer actions
    var actions = win.add("group");
    actions.alignment = "right";
    var cancelBtn = actions.add("button", undefined, "Cancel");
    cancelBtn.onClick = function () {
        PROCESS_CANCELLED = true;
        try { win.statusText.text = "Cancelling..."; } catch(e){}
    };

    // Helper: update status + optional progress (0..100)
    win.updateStatus = function (status, pct) {
        try {
            if (status) win.statusText.text = status;
            if (typeof pct === "number") {
                if (pct < 0) pct = 0; if (pct > 100) pct = 100;
                win.pb.value = pct;
            } else {
                // bump kecil agar terasa hidup walau tak ada angka pasti
                win.pb.value = Math.min(100, win.pb.value + 1);
            }
            win.update();
        } catch(e){}
    };

    // Helper: finish (menutup dengan aman)
    win.finish = function (finalMsg) {
        try {
            if (finalMsg) { win.updateStatus(finalMsg, 100); }
        } catch(e){}
        try { $.sleep(300); } catch(e){}
        try { if (win && win.visible) win.close(); } catch(e){}
    };

    win.center();
    win.show();
    return win;
}


// ===== CURL DETECTION =====
function checkCurlAvailable() {
    try {
        var testFile = new File(Folder.temp + "/curl_test_" + new Date().getTime() + ".txt");
        
        var cmd;
        if (CONFIG.IS_WINDOWS) {
            cmd = 'cmd.exe /c "curl.exe --version > "' + testFile.fsName + '" 2>&1"';
        } else {
            cmd = 'curl --version > "' + testFile.fsName + '" 2>&1';
        }
        
        app.system(cmd);
        
        if (testFile.exists) {
            setUtf8(testFile);
            testFile.open("r");
            var result = testFile.read();
            testFile.close();
            testFile.remove();
            return result.indexOf("curl") > -1;
        }
        return false;
        
    } catch(e) {
        return false;
    }
}

function showCurlMissingDialog() {
    var dialog = new Window("dialog", "Curl Not Found");
    dialog.orientation = "column";
    dialog.alignChildren = "fill";
    dialog.preferredSize.width = 450;
    
    var message = dialog.add("statictext", undefined, 
        "This plugin requires curl to be installed.\n\n" +
        "• macOS: Curl is pre-installed\n" +
        "• Windows 10/11: Curl should be pre-installed\n" +
        "• Older Windows: Not supported\n\n" +
        "If you're on Windows 10/11 and seeing this message,\n" +
        "please update Windows or contact support.", 
        {multiline: true});
    message.preferredSize.height = 150;
    
    var okBtn = dialog.add("button", undefined, "OK");
    okBtn.onClick = function() { dialog.close(); };
    
    dialog.show();
}

// ===== CURL OPERATIONS =====
function executeCurl(curlArgs, outputFile) {
    var cmd;
    if (CONFIG.IS_WINDOWS) {
        // gunakan cmd, redirect ke file
        cmd = 'cmd.exe /c "curl.exe ' + curlArgs + ' > "' + outputFile + '" 2>&1"';
    } else {
        cmd = 'curl ' + curlArgs + ' > "' + outputFile + '" 2>&1';
    }
    app.system(cmd);
    
    if (outputFile) {
        var file = new File(outputFile);
        if (file.exists) {
            setUtf8(file);
            file.open("r");
            var content = file.read();
            file.close();
            file.remove();
            return content;
        }
    }
    return null;
}

/**
 * Base64 encode image - with Windows path fix
 */
function encodeImageBase64(imageFile, progressWin, isReference) {
    var tempScaledFile = null;
    try {
        if (progressWin) {
            var msg = (isReference === true) ? "Processing reference image..." : "Encoding image...";
            progressWin.updateStatus(msg);
        }
        var fileToEncode = imageFile;
        // If this image is a reference, optionally scale it to avoid errors on Windows
        if (isReference === true) {
            tempScaledFile = scaleReferenceImage(imageFile);
            if (tempScaledFile) {
                fileToEncode = tempScaledFile;
            }
        }
        var outputFile = new File(Folder.temp + "/base64_" + new Date().getTime() + ".txt");
        if (CONFIG.IS_WINDOWS) {
            var fileName = fileToEncode.name || "";
            var ext = "";
            var dotIndex = fileName.lastIndexOf(".");
            if (dotIndex > -1) ext = fileName.substring(dotIndex);
            if (!ext) ext = ".jpg";
            var tempCopy = new File(Folder.temp + "/temp_encode_" + new Date().getTime() + ext);
            var copySuccess = false;
            try { copySuccess = fileToEncode.copy(tempCopy.fsName); } catch(e) { copySuccess = false; }
            if (!copySuccess) {
                app.system('cmd.exe /c copy /Y "' + fileToEncode.fsName + '" "' + tempCopy.fsName + '"');
            }
            if (!tempCopy.exists) {
                if (progressWin) progressWin.updateStatus("Error: Could not copy file");
                if (tempScaledFile) tempScaledFile.remove();
                return null;
            }
            var cmd = 'cmd.exe /c "certutil -encode "' + tempCopy.fsName + '" "' + outputFile.fsName + '""';
            app.system(cmd);
            tempCopy.remove();
            if (outputFile.exists) {
                setUtf8(outputFile);
                outputFile.open("r");
                var data = outputFile.read();
                outputFile.close();
                outputFile.remove();
                if (tempScaledFile) tempScaledFile.remove();
                data = data.replace(/-----BEGIN CERTIFICATE-----/g, "").replace(/-----END CERTIFICATE-----/g, "").replace(/[\r\n\s]/g, "");
                return data;
            }
        } else {
            var cmd = 'base64 -i "' + fileToEncode.fsName + '" > "' + outputFile.fsName + '"';
            app.system(cmd);
            if (outputFile.exists) {
                setUtf8(outputFile);
                outputFile.open("r");
                var data = outputFile.read();
                outputFile.close();
                outputFile.remove();
                if (tempScaledFile) tempScaledFile.remove();
                return data.replace(/[\r\n\s]/g, "");
            }
        }
        if (tempScaledFile) tempScaledFile.remove();
    } catch(e) {
        if (progressWin) progressWin.updateStatus("Encoding error: " + e.message);
        if (tempScaledFile) tempScaledFile.remove();
    }
    return null;
}

// ===== TEST DOWNLOAD FUNCTION =====
function testDownload() {
    var testUrl = "https://replicate.delivery/yhqm/WzvCNeH5MTWEci4rOuIcQ2zmIGeFyIlKSyGZhqNDCFn4HkqAVtmpj7je568.jpeg";
    alert("Testing download with URL:\n" + testUrl);
    var fakeResponse = '{"ok":true,"status":"succeeded","output":"' + testUrl + '"}';
    var result = downloadResult(fakeResponse);
    if (result && result.exists) {
        alert("Test download SUCCESS!\nFile: " + result.fsName + "\nSize: " + result.length + " bytes");
        try { app.open(result); } catch(e) { alert("Could not open downloaded file: " + e.message); }
    } else {
        alert("Test download FAILED");
    }
}

// Custom Helper to get real error message
function extractApiErrorMessage(json) {
    try {
        var m = /"detail"\s*:\s*"([^"]+)"/.exec(json);
        if (m) return m[1];
        var m2 = /"error"\s*:\s*{[^}]*"message"\s*:\s*"([^"]+)"/.exec(json);
        if (m2) return m2[1];
        var m3 = /"error"\s*:\s*"([^"]+)"/.exec(json);
        if (m3) return m3[1];
    } catch(e){}
    return null;
}

function pollForResult(predictionId, progressWin) {
    var maxAttempts = CONFIG.MAX_POLL_ATTEMPTS;
    for (var i = 0; i < maxAttempts; i++) {
        if (PROCESS_CANCELLED) return null;
        $.sleep(CONFIG.POLL_INTERVAL * 1000);
        if (progressWin) {
            var percent = Math.round((i / maxAttempts) * 70) + 10; // 10..80 selama poll
            progressWin.updateStatus("AI is working... " + percent + "%", percent);
        }
        var statusFile = new File(Folder.temp + "/status_" + new Date().getTime() + ".json");
        var curlArgs = '-s -H "Authorization: Token ' + CONFIG.API_KEY + '" ' +
                       '"https://api.replicate.com/v1/predictions/' + predictionId + '"';
        var response = executeCurl(curlArgs, statusFile.fsName);
        if (response && !PROCESS_CANCELLED) {
            if (response.indexOf('"status":"succeeded"') > -1) {
                if (progressWin) progressWin.updateStatus("Generating result...");
                return downloadResult(response);
            } else if (response.indexOf('"status":"failed"') > -1) {
                alert("Generation failed");
                return null;
            }
        }
    }
    if (!PROCESS_CANCELLED) alert("Timeout - please try again");
    return null;
}

// ===== ROBUST DOWNLOAD WITH MULTIPLE FALLBACKS =====
function downloadResultRobust(response, progressWin) {
    try {
        if (progressWin) progressWin.updateStatus("Parsing result URL...", 15);
        var outputUrl = extractOutputUrl(response);
        if (!outputUrl) { alert("Could not find output URL in response"); return null; }

        if (progressWin) progressWin.updateStatus("Generating (method 1)...", 25);
        var result = downloadWithCurl(outputUrl);
        if (result && result.exists && result.length > 1000) {
            if (progressWin) progressWin.updateStatus("Download complete.", 80);
            return result;
        }

        if (progressWin) progressWin.updateStatus("Retrying download (method 2)...", 40);
        result = downloadWithCurlAlternative(outputUrl);
        if (result && result.exists && result.length > 1000) {
            if (progressWin) progressWin.updateStatus("Download complete (alt).", 80);
            return result;
        }

        if (progressWin) progressWin.updateStatus("Opening browser for manual download...", 50);
        alert("Automatic download failed. Opening URL in browser...\nPlease save the image manually to your temp folder and click OK when done.");
        var browserCmd = 'cmd.exe /c start "" "' + outputUrl + '"';
        app.system(browserCmd);
        if (progressWin) progressWin.updateStatus("Waiting for your manual selection...", 55);
        var manualFile = showManualDownloadDialog();
        if (manualFile && manualFile.exists) {
            if (progressWin) progressWin.updateStatus("Using manually selected file.", 80);
            return manualFile;
        }
        return null;
    } catch(e) {
        alert("Download error: " + e.message);
        return null;
    }
}


// Method 1: Standard curl download
function downloadWithCurl(url) {
    try {
        var timestamp = new Date().getTime();
        var downloadFile = new File(Folder.temp + "/ai_result_" + timestamp + ".jpg");
        var logFile = new File(Folder.temp + "/download_log_" + timestamp + ".txt");
        var scriptFile = new File(Folder.temp + "/download_" + timestamp + ".bat");
        setUtf8(scriptFile);
        scriptFile.open("w");
        scriptFile.writeln('@echo off');
        scriptFile.writeln('chcp 65001>nul');
        scriptFile.writeln('echo Downloading with standard method...');
        scriptFile.writeln('curl.exe -L --connect-timeout 30 --max-time 300 ^');
        scriptFile.writeln('  --ssl-no-revoke --insecure ^');
        scriptFile.writeln('  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" ^');
        scriptFile.writeln('  -H "Accept: image/*,*/*;q=0.8" ^');
        scriptFile.writeln('  -H "Accept-Encoding: identity" ^');
        scriptFile.writeln('  --compressed ^');
        scriptFile.writeln('  -o "' + downloadFile.fsName + '" ^');
        scriptFile.writeln('  "' + url + '" ^');
        scriptFile.writeln('  >"' + logFile.fsName + '" 2>&1');
        scriptFile.writeln('echo Exit code: %ERRORLEVEL% >>"' + logFile.fsName + '"');
        scriptFile.close();
        app.system('cmd.exe /c "' + scriptFile.fsName + '"');
        $.sleep(3000);
        try { scriptFile.remove(); } catch(e) {}
        try { logFile.remove(); } catch(e) {}
        return downloadFile;
    } catch(e) { return null; }
}

// Method 2: Alternative curl with different settings
function downloadWithCurlAlternative(url) {
    try {
        var timestamp = new Date().getTime();
        var downloadFile = new File(Folder.temp + "/ai_result_alt_" + timestamp + ".jpg");
        var scriptFile = new File(Folder.temp + "/download_alt_" + timestamp + ".bat");
        setUtf8(scriptFile);
        scriptFile.open("w");
        scriptFile.writeln('@echo off');
        scriptFile.writeln('chcp 65001>nul');
        scriptFile.writeln('echo Downloading with alternative method...');
        scriptFile.writeln('curl.exe --location --insecure --silent ^');
        scriptFile.writeln('  --retry 3 --retry-delay 2 ^');
        scriptFile.writeln('  --connect-timeout 60 --max-time 600 ^');
        scriptFile.writeln('  --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:91.0) Gecko/20100101 Firefox/91.0" ^');
        scriptFile.writeln('  --header "Accept: image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" ^');
        scriptFile.writeln('  --header "Accept-Language: en-US,en;q=0.9" ^');
        scriptFile.writeln('  --header "Cache-Control: no-cache" ^');
        scriptFile.writeln('  --header "Pragma: no-cache" ^');
        scriptFile.writeln('  --output "' + downloadFile.fsName + '" ^');
        scriptFile.writeln('  "' + url + '"');
        scriptFile.close();
        app.system('cmd.exe /c "' + scriptFile.fsName + '"');
        $.sleep(5000);
        try { scriptFile.remove(); } catch(e) {}
        return downloadFile;
    } catch(e) { return null; }
}

// Method 3: Manual download dialog
function showManualDownloadDialog() {
    var dialog = new Window("dialog", "Manual Download Required");
    dialog.orientation = "column";
    dialog.alignChildren = "fill";
    dialog.preferredSize.width = 500;
    dialog.margins = 15;
    dialog.spacing = 10;
    
    var infoText = dialog.add("statictext", undefined, 
        "The automatic download failed. Please:\n\n" +
        "1. Save the image from your browser to your computer\n" +
        "2. Click 'Browse' below to select the downloaded file\n" +
        "3. Click 'OK' to continue", 
        {multiline: true});
    infoText.preferredSize.height = 80;
    
    var fileGroup = dialog.add("group");
    fileGroup.add("statictext", undefined, "Selected file:");
    var fileLabel = fileGroup.add("statictext", undefined, "(none selected)");
    fileLabel.preferredSize.width = 300;
    
    var browseBtn = dialog.add("button", undefined, "Browse for Downloaded Image...");
    var selectedFile = null;
    
    browseBtn.onClick = function() {
        var file = File.openDialog("Select the downloaded image", "Image files:*.jpg;*.jpeg;*.png;*.webp");
        if (file) {
            selectedFile = file;
            fileLabel.text = file.name;
        }
    };
    
    var buttonGroup = dialog.add("group");
    buttonGroup.alignment = "center";
    var okBtn = buttonGroup.add("button", undefined, "OK");
    var cancelBtn = buttonGroup.add("button", undefined, "Cancel");
    
    okBtn.onClick = function() {
        if (!selectedFile) {
            alert("Please select a file first");
            return;
        }
        dialog.close(1);
    };
    
    cancelBtn.onClick = function() { dialog.close(0); };
    
    var result = dialog.show();
    if (result == 1 && selectedFile && selectedFile.exists) {
        var timestamp = new Date().getTime();
        var tempFile = new File(Folder.temp + "/ai_result_manual_" + timestamp + ".jpg");
        try { selectedFile.copy(tempFile.fsName); return tempFile; }
        catch(e) { alert("Could not copy file: " + e.message); return selectedFile; }
    }
    return null;
}

// ===== IMPROVED MAIN API FUNCTION =====
function callAPIImproved(imageFile, referenceFile, prompt, modelVersion, isNanoBanana, progressWin) {
    try {
        if (PROCESS_CANCELLED) return null;

        var auth = loadAuth();
        if (!auth) { alert("Tidak ada token lokal. Silakan aktivasi."); return null; }

        // encode the main selection (not a reference)
        var base64Data = encodeImageBase64(imageFile, progressWin, false);
        if (!base64Data || PROCESS_CANCELLED) { if (!PROCESS_CANCELLED) alert("Could not encode image"); return null; }
        var mainImageUrl = "data:image/jpeg;base64," + base64Data;

        var arr = [ mainImageUrl ];
        if (referenceFile && referenceFile.exists && isNanoBanana) {
            if (progressWin) progressWin.updateStatus("Encoding reference image...");
            // encode reference with flag true to allow optional downscaling
            var refBase64 = encodeImageBase64(referenceFile, progressWin, true);
            if (refBase64) {
                arr.unshift("data:image/jpeg;base64," + refBase64);
            }
        }

        if (progressWin) progressWin.updateStatus("Sending to server...", 10);
        var payload = {
            name: auth.name,
            token: auth.token,
            model: "google/nano-banana",
            version: modelVersion,
            prompt: prompt,
            image_input: arr
        };

        var resp = postJson(CONFIG.BACKEND_BASE + "/generate.php", payload);
        if (!resp || PROCESS_CANCELLED) { alert("No response from server"); return null; }

        if (resp.indexOf('"ok":false') > -1) {
            if (resp.indexOf('no_token') > -1) {
                alert("Kamu belum punya izin. Silakan aktivasi dengan Nama & Kode.");
            } else if (resp.indexOf('blocked') > -1) {
                alert("Token kamu diblokir admin."); 
                clearAuth();
            } else {
                alert("Server error: " + resp.substring(0, 200));
            }
            return null;
        }
        
        if (resp.indexOf('"output"') > -1) {
            if (progressWin) progressWin.updateStatus("Generating result...");
            return downloadResultRobust(resp, progressWin);
        } else {
            alert("No output in server response");
            return null;
        }
    } catch (e) {
        if (!PROCESS_CANCELLED) alert("API error: " + e.message);
        return null;
    }
}

// ===== UPSCALE VIA SERVER API FUNCTION =====
function upscaleViaServer(imageFile, auth, progressWin) {
    try {
        if (PROCESS_CANCELLED) return null;
        if (progressWin) progressWin.updateStatus("Preparing HD upscale...");

        $.writeln("[HD] Start upscaleViaServer()");

        // encode jadi data URL
        var base64Data = encodeImageBase64(imageFile, progressWin);
        if (!base64Data) { alert("Could not encode image for HD"); return null; }
        var dataUrl = "data:image/jpeg;base64," + base64Data;

        if (progressWin) progressWin.updateStatus("Sending to server (HD)...");
        var payload = {
            name: auth.name,
            token: auth.token,
            scale: 2,
            face_enhance: false,
            image: dataUrl
        };

        var resp = postJson(CONFIG.BACKEND_BASE + "/upscale.php", payload);
        $.writeln("[HD] Server response (first 200): " + (resp ? resp.substring(0,200) : "(no response)"));

        if (!resp || PROCESS_CANCELLED) { alert("No response from server (HD)"); return null; }

        if (resp.indexOf('"ok":false') > -1) {
            alert("HD server error: " + resp.substring(0, 200));
            return null;
        }
        if (resp.indexOf('"output"') > -1) {
            if (progressWin) progressWin.updateStatus("Generating HD result...");
            return downloadResultRobust(resp);
        }
        alert("No output in HD response");
        return null;
    } catch(e) {
        alert("HD error: " + e.message);
        return null;
    }
}


function upscaleImage(imageFile, progressWin) {
    try {
        if (progressWin) progressWin.updateStatus("Preparing upscale...");
        var base64Data = encodeImageBase64(imageFile, null);
        if (!base64Data || PROCESS_CANCELLED) return imageFile;
        var dataUrl = "data:image/jpeg;base64," + base64Data;
        
        var payload = '{"version":"f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa",' +
                      '"input":{' +
                      '"image":"' + dataUrl + '",' +
                      '"scale":2,' +
                      '"face_enhance":false' +
                      '}}';
        
        var payloadFile = new File(Folder.temp + "/upscale_payload_" + new Date().getTime() + ".json");
        setUtf8(payloadFile);
        payloadFile.open("w");
        payloadFile.write(payload);
        payloadFile.close();
        
        if (progressWin) progressWin.updateStatus("Sending to upscaler...");
        
        var responseFile = new File(Folder.temp + "/upscale_response_" + new Date().getTime() + ".json");
        setUtf8(responseFile);
        var curlArgs = '-s -X POST ' +
                       '-H "Authorization: Token ' + CONFIG.API_KEY + '" ' +
                       '-H "Content-Type: application/json; charset=utf-8" ' +
                       '-d @"' + payloadFile.fsName + '" ' +
                       '"https://api.replicate.com/v1/predictions"';
        var response = executeCurl(curlArgs, responseFile.fsName);
        payloadFile.remove();
        
        if (response && !PROCESS_CANCELLED) {
            var predictionId = extractPredictionId(response);
            if (predictionId) {
                if (progressWin) progressWin.updateStatus("Upscaling in progress...");
                var upscaledFile = pollForResult(predictionId, progressWin);
                if (upscaledFile && upscaledFile.exists) { imageFile.remove(); return upscaledFile; }
            }
        }
        return imageFile;
    } catch(e) { return imageFile; }
}

// ===== PROCESSING FUNCTIONS =====
// ===== PROCESSING FUNCTIONS =====
function processSelection(prompt, modelName, newDocument, upscale, referenceFile, wantHD) {
    try {
        // pastikan flag tidak undefined
        wantHD = (wantHD === true);

        var doc = app.activeDocument;
        var modelVersion = CONFIG.MODELS[modelName];
        var isNanoBanana = modelName.indexOf("Nano") > -1;

        var savedSelection = doc.channels.add();
        savedSelection.name = "AI Selection";
        doc.selection.store(savedSelection);

        var bounds = doc.selection.bounds;
        var x1 = Math.round(bounds[0].value);
        var y1 = Math.round(bounds[1].value);
        var x2 = Math.round(bounds[2].value);
        var y2 = Math.round(bounds[3].value);

        var tempFile = exportSelection(doc, x1, y1, x2, y2);
        if (!tempFile || !tempFile.exists) {
            alert("Could not export selection");
            savedSelection.remove();
            return;
        }

        var progressWin = createProgressWindow(modelName);
        progressWin.updateStatus("Exporting selection...", 5);

        var resultFile = callAPIImproved(
            tempFile, referenceFile, prompt, modelVersion, isNanoBanana, progressWin
        );
        try { tempFile.remove(); } catch(e) {}

        var baseFile = resultFile;     // simpan file hasil generate (Base)
        var hdFile   = null;

        // === Jika user minta HD, jalankan upscale tapi JANGAN gantikan baseFile ===
        if (baseFile && wantHD && !PROCESS_CANCELLED) {
            if (progressWin) progressWin.updateStatus("HD requested. Upscaling via server...", 86);
            var auth = loadAuth();
            if (!auth) {
                alert("Token hilang. Silakan aktivasi ulang.");
            } else {
                hdFile = upscaleViaServer(baseFile, auth, progressWin);
            }
        }

        if (PROCESS_CANCELLED) {
            if (progressWin && progressWin.visible) progressWin.finish("Cancelled.");
            try { savedSelection.remove(); } catch(e){}
            return;
        }

        // === Tempatkan 1) Base, lalu 2) HD (jika ada) ===
        if (baseFile && baseFile.exists) {
            if (progressWin && progressWin.visible) {
                progressWin.updateStatus("Placing base result...", 85);
            }
            // taruh base, jangan remove savedSelection
            var baseLayer = placeResultInDocumentKeepSelection(
                doc, baseFile, x1, y1, x2, y2, savedSelection, (prompt.substring(0,30) + " (Base)")
            );
        }

        if (hdFile && hdFile.exists && !PROCESS_CANCELLED) {
            if (progressWin && progressWin.visible) {
                progressWin.updateStatus("Placing HD result...", 95);
            }
            var hdLayer = placeResultInDocumentKeepSelection(
                doc, hdFile, x1, y1, x2, y2, savedSelection, (prompt.substring(0,30) + " (HD)")
            );
            // opsional: letakkan HD di atas base
            try { if (hdLayer) hdLayer.move(doc.layers[0], ElementPlacement.PLACEBEFORE); } catch(e){}
        }

        // selesai, sekarang baru hapus channel seleksi
        try { savedSelection.remove(); } catch(e){}

        // cleanup file sementara
        try { if (baseFile && baseFile.exists) baseFile.remove(); } catch(e){}
        try { if (hdFile && hdFile.exists) hdFile.remove(); } catch(e){}

        // tutup progress dengan pesan jelas
        if (progressWin && progressWin.visible) {
            var doneMsg = "Done.";
            if (hdFile && hdFile.exists) doneMsg = "Done (Base + HD placed)";
            else if (baseFile && baseFile.exists) doneMsg = "Done (Base placed)";
            progressWin.finish(doneMsg);
        }

    } catch(e) {
        alert("Processing error: " + e.message);
    }
}


// ===== SIMPLE TEST FUNCTION =====
function testManualDownload() {
    alert("Testing manual download dialog...");
    var file = showManualDownloadDialog();
    if (file) {
        alert("Selected file: " + file.fsName + "\nSize: " + file.length + " bytes");
    } else {
        alert("No file selected");
    }
}

function exportSelection(doc, x1, y1, x2, y2) {
    try {
        doc.selection.deselect();
        doc.artLayers.add();
        var tempLayer = doc.activeLayer;
        tempLayer.name = "Temp Merged";
        
        selectAll();
        copyMerged();
        doc.paste();
        
        var cropDoc = doc.duplicate("temp_crop", true);
        cropDoc.crop([x1, y1, x2, y2]);
        
        var width = cropDoc.width.value;
        var height = cropDoc.height.value;
        var maxDim = CONFIG.MAX_DIMENSION;
        
        if (width > maxDim || height > maxDim) {
            var scale = maxDim / Math.max(width, height);
            var newWidth = Math.round(width * scale);
            var newHeight = Math.round(height * scale);
            cropDoc.resizeImage(UnitValue(newWidth, "px"), UnitValue(newHeight, "px"), null, ResampleMethod.BICUBIC);
        }
        
        var timestamp = new Date().getTime();
        var tempFile = new File(Folder.temp + "/ai_input_" + timestamp + ".jpg");
        
        var saveOptions = new JPEGSaveOptions();
        saveOptions.quality = CONFIG.JPEG_QUALITY;
        cropDoc.saveAs(tempFile, saveOptions, true, Extension.LOWERCASE);
        
        cropDoc.close(SaveOptions.DONOTSAVECHANGES);
        
        doc.activeLayer = tempLayer;
        tempLayer.remove();
        
        return tempFile;
        
    } catch(e) {
        alert("Export error: " + e.message);
        return null;
    }
}

// ===== API KEY MANAGEMENT =====
function getAPIKey() {
    var apiKey = loadAPIKey();
    if (!apiKey || apiKey.length < 10) {
        apiKey = promptForAPIKey();
        if (apiKey && apiKey.length > 10) saveAPIKey(apiKey);
    }
    return apiKey;
}

function getPreferencesFile() {
    // Simpan di folder baru RuparayaAIAPI
    var prefsFolder = new Folder(Folder.userData + "/RuparayaAIAPI");
    if (!prefsFolder.exists) { prefsFolder.create(); }
    return new File(prefsFolder + "/preferences.json");
}

function loadPreferences() {
    try {
        var prefsFile = getPreferencesFile();
        if (prefsFile.exists) {
            setUtf8(prefsFile);
            prefsFile.open("r");
            var content = prefsFile.read();
            prefsFile.close();
            var prefs = {};
            var apiKeyMatch = content.match(/"apiKey"\s*:\s*"([^"]+)"/);
            if (apiKeyMatch) prefs.apiKey = apiKeyMatch[1];
            var modelMatch = content.match(/"lastModel"\s*:\s*"([^"]+)"/);
            if (modelMatch) prefs.lastModel = modelMatch[1];
            return prefs;
        }
    } catch(e) {}
    return {};
}

function debugConnectivity() {
    var tmp = new File(Folder.temp + "/curl_head_" + new Date().getTime() + ".txt");
    var cmd = 'cmd.exe /c "curl.exe -I --connect-timeout 10 https://ruparaya-dev.com/ai-api/issue-token.php > \\"' + tmp.fsName + '\\" 2>&1"';
    app.system(cmd);
    var out = "(no file)";
    if (tmp.exists) { setUtf8(tmp); tmp.open("r"); out = tmp.read(); tmp.close(); tmp.remove(); }
    alert("HEAD check:\n" + out.substring(0,400));
}

function saveAPIKey(apiKey) {
    try {
        var prefs = loadPreferences();
        var prefsFile = getPreferencesFile();
        setUtf8(prefsFile);
        prefsFile.open("w");
        var json = '{"apiKey":"' + apiKey + '"';
        if (prefs.lastModel) json += ',"lastModel":"' + prefs.lastModel + '"';
        json += '}';
        prefsFile.write(json);
        prefsFile.close();
        return true;
    } catch(e) { return false; }
}

function loadAPIKey() {
    try {
        var prefsFile = getPreferencesFile();
        if (prefsFile.exists) {
            setUtf8(prefsFile);
            prefsFile.open("r");
            var content = prefsFile.read();
            prefsFile.close();
            var match = content.match(/"apiKey"\s*:\s*"([^"]+)"/);
            if (match && match[1]) return match[1];
        }
    } catch(e) {}
    return null;
}

function loadLastModel() {
    try {
        var prefsFile = getPreferencesFile();
        if (prefsFile.exists) {
            setUtf8(prefsFile);
            prefsFile.open("r");
            var content = prefsFile.read();
            prefsFile.close();
            var match = content.match(/"lastModel"\s*:\s*"([^"]+)"/);
            if (match && match[1]) return match[1];
        }
    } catch(e) {}
    return null;
}

function saveLastModel(modelName) {
    try {
        var prefs = loadPreferences();
        var prefsFile = getPreferencesFile();
        setUtf8(prefsFile);
        prefsFile.open("w");
        var json = '{';
        if (prefs.apiKey) json += '"apiKey":"' + prefs.apiKey + '"';
        if (modelName) {
            if (prefs.apiKey) json += ',';
            json += '"lastModel":"' + modelName + '"';
        }
        json += '}';
        prefsFile.write(json);
        prefsFile.close();
    } catch(e) {}
}

function promptForAPIKey(fromSettings) {
    var dialog = new Window("dialog", "Replicate API Key " + (fromSettings ? "Settings" : "Required"));
    dialog.orientation = "column";
    dialog.alignChildren = "fill";
    dialog.preferredSize.width = 450;
    dialog.margins = 15;
    dialog.spacing = 10;
    
    var instructionPanel = dialog.add("panel", undefined, fromSettings ? "Update API Key" : "First Time Setup");
    instructionPanel.alignChildren = "left";
    instructionPanel.margins = 10;
    instructionPanel.add("statictext", undefined, "1. Go to replicate.com and create an account");
    instructionPanel.add("statictext", undefined, "2. Go to replicate.com/account/api-tokens");
    instructionPanel.add("statictext", undefined, "3. Copy your API token (starts with 'r8_...')");
    instructionPanel.add("statictext", undefined, "4. Paste it below:");
    instructionPanel.add("statictext", undefined, "5. Get API key from Onil");
    
    var apiKeyGroup = dialog.add("group");
    apiKeyGroup.add("statictext", undefined, "API Key:");
    var apiKeyInput = apiKeyGroup.add("edittext", undefined, "");
    apiKeyInput.characters = 40;
    
    if (fromSettings && CONFIG.API_KEY) {
        apiKeyInput.text = CONFIG.API_KEY;
        apiKeyInput.active = true;
        var maskedKey = CONFIG.API_KEY.substr(0, 8) + "..." + CONFIG.API_KEY.substr(-4);
        var currentKeyText = dialog.add("statictext", undefined, "Current key: " + maskedKey);
        currentKeyText.graphics.font = ScriptUI.newFont(currentKeyText.graphics.font.name, ScriptUI.FontStyle.ITALIC, 10);
    } else {
        apiKeyInput.active = true;
    }
    
    var privacyText = dialog.add("statictext", undefined, "Your API key is stored locally in your user preferences");
    privacyText.graphics.font = ScriptUI.newFont(privacyText.graphics.font.name, ScriptUI.FontStyle.ITALIC, 10);
    
    var buttonGroup = dialog.add("group");
    buttonGroup.alignment = "center";
    var okButton = buttonGroup.add("button", undefined, fromSettings ? "Update" : "OK");
    var cancelButton = buttonGroup.add("button", undefined, "Cancel");
    
    okButton.onClick = function() {
        if (apiKeyInput.text.length < 10) {
            if (fromSettings) dialog.close(0);
            else alert("Please enter a valid API key");
        } else {
            dialog.close(1);
        }
    };
    cancelButton.onClick = function() { dialog.close(0); };
    
    var result = dialog.show();
    if (result == 1) return apiKeyInput.text;
    return null;
}

function testAPIKey(apiKey) {
    try {
        apiKey = apiKey.replace(/^\s+|\s+$/g, '');
        if (apiKey.indexOf("r8_") !== 0) return false;
        $.sleep(100);
        var testFile = new File(Folder.temp + "/test_" + new Date().getTime() + ".json");
        var scriptFile = new File(Folder.temp + "/test_api_" + new Date().getTime() + (CONFIG.IS_WINDOWS ? ".bat" : ".sh"));
        setUtf8(scriptFile);
        scriptFile.open("w");
        if (CONFIG.IS_WINDOWS) {
            scriptFile.writeln('@echo off');
            scriptFile.writeln('chcp 65001>nul');
            scriptFile.writeln('curl.exe -s -H "Authorization: Token ' + apiKey + '" "https://api.replicate.com/v1/account" > "' + testFile.fsName + '"');
        } else {
            scriptFile.writeln('#!/bin/bash');
            scriptFile.writeln('curl -s -H "Authorization: Token ' + apiKey + '" "https://api.replicate.com/v1/account" > "' + testFile.fsName + '"');
        }
        scriptFile.close();
        if (CONFIG.IS_WINDOWS) app.system('cmd.exe /c "' + scriptFile.fsName + '"');
        else app.system('chmod +x "' + scriptFile.fsName + '" && "' + scriptFile.fsName + '"');
        scriptFile.remove();
        if (testFile.exists) {
            setUtf8(testFile);
            testFile.open("r");
            var response = testFile.read();
            testFile.close();
            testFile.remove();
            if (response.indexOf("username") > -1) return true;
            if (response.indexOf("authentication") > -1) return false;
            return true;
        }
        return true;
    } catch(e) { return true; }
}

// ===== MAIN DIALOG =====
function createDialog() {
    var dialog = new Window("dialog", "Lyra - Ruparaya AI (v1.0)");
    dialog.orientation = "column";
    dialog.alignChildren = "fill";
    dialog.margins = 16;
    dialog.spacing = 12;

    dialog.preferredSize.width = 720;

    var mainRow = dialog.add("group");
    mainRow.orientation = "row";
    mainRow.alignChildren = ["fill", "top"];
    mainRow.spacing = 12;

    var promptPanel = mainRow.add("panel", undefined, "Prompt");
    promptPanel.alignChildren = "fill";
    promptPanel.margins = 12;
    promptPanel.preferredSize.width = 620;

    dialog.promptInput = promptPanel.add("edittext", undefined, "", { multiline: true, scrollable: true });
    dialog.promptInput.preferredSize = [0, 260];
    dialog.promptInput.active = true;

    var rightCol = mainRow.add("group");
    rightCol.orientation = "column";
    rightCol.alignChildren = ["left","top"];
    rightCol.margins = 0;

    dialog.colorCheckbox = rightCol.add("checkbox", undefined, "Gunakan warna referensi");
    dialog.colorCheckbox.value = false;

    var fgText = rightCol.add("statictext", undefined, "Warna aktif: " + (function(){
        try {
            var rgb = app.foregroundColor.rgb;
            return "#" + toHex(Math.round(rgb.red)) + toHex(Math.round(rgb.green)) + toHex(Math.round(rgb.blue));
        } catch(e){ return "(tidak tersedia)"; }
    })());

    // === HD checkbox (upscale via server) ===
    dialog.hdCheckbox = rightCol.add("checkbox", undefined, "HD");
    dialog.hdCheckbox.value = false; // default off

    // === Reference image selector ===
    // Group containing label and buttons for selecting an optional reference image
    var refGroup = rightCol.add("group");
    refGroup.orientation = "row";
    refGroup.alignChildren = ["left", "center"];
    var refLabel = refGroup.add("statictext", undefined, "Referensi: (none)");
    refLabel.characters = 24;
    var addRefBtn = refGroup.add("button", undefined, "Add...");
    var clearRefBtn = refGroup.add("button", undefined, "Clear");
    // Set default reference file property on dialog
    dialog.referenceFile = null;
    addRefBtn.onClick = function() {
        var f = File.openDialog("Pilih gambar referensi", "Images:*.jpg;*.jpeg;*.png");
        if (f) {
            dialog.referenceFile = f;
            refLabel.text = "Referensi: " + f.name;
        }
    };
    clearRefBtn.onClick = function() {
        dialog.referenceFile = null;
        refLabel.text = "Referensi: (none)";
    };

    dialog.newDocCheckbox  = { value: false };
    dialog.upscaleCheckbox = { value: false };

    var footer = dialog.add("group");
    footer.alignment = "center";
    var generateButton = footer.add("button", undefined, "Generate");
    var cancelButton   = footer.add("button", undefined, "Cancel");

    generateButton.onClick = function () { dialog.close(1); };
    cancelButton.onClick   = function () { dialog.close(0); };

    return dialog;
}

// ===== HELPER FUNCTIONS =====
function extractPredictionId(response) {
    try {
        var match = response.match(/"id"\s*:\s*"([^"]+)"/);
        if (match && match[1]) return match[1];
    } catch(e) {}
    return null;
}

// ===== IMPROVED EXTRACT OUTPUT URL =====
function extractOutputUrl(response) {
    try {
        var patterns = [
            /"output"\s*:\s*"([^"]+)"/,
            /"output"\s*:\s*\[\s*"([^"]+)"/,
            /https:\/\/[^"\s]+\.(?:jpg|jpeg|png|webp)/gi
        ];
        for (var i = 0; i < patterns.length; i++) {
            var match = response.match(patterns[i]);
            if (match && match[1]) {
                var url = match[1].replace(/\\\//g, '/');
                return url;
            }
        }
        var deliveryMatch = response.match(/https:\/\/replicate\.delivery\/[^"\s]+/);
        if (deliveryMatch) return deliveryMatch[0];
        return null;
    } catch(e) { alert("extractOutputUrl error: " + e.message); return null; }
}

function escapeJsonString(str) {
    return str.replace(/\\/g, '\\\\')
              .replace(/"/g, '\\"')
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r')
              .replace(/\t/g, '\\t');
}

function toHex(n) {
    var hex = Math.round(n).toString(16);
    if (hex.length < 2) hex = "0" + hex;
    return hex.toUpperCase();
}

function hasActiveSelection() {
    try { var bounds = app.activeDocument.selection.bounds; return true; }
    catch (e) { return false; }
}

function placeResultInDocument(doc, resultFile, x1, y1, x2, y2, savedSelection, prompt) {
    try {
        var resultDoc = app.open(resultFile);
        resultDoc.artLayers[0].duplicate(doc, ElementPlacement.PLACEATBEGINNING);
        resultDoc.close(SaveOptions.DONOTSAVECHANGES);
        var newLayer = doc.artLayers[0];
        var nm = (prompt || "").replace(/[\\\/:\*\?"<>\|]+/g, " ").substring(0, 30);
        newLayer.name = nm;
        
        var targetWidth = x2 - x1;
        var targetHeight = y2 - y1;
        var currentBounds = newLayer.bounds;
        var currentWidth = currentBounds[2].value - currentBounds[0].value;
        var currentHeight = currentBounds[3].value - currentBounds[1].value;
        if (Math.abs(currentWidth - targetWidth) > 1 || Math.abs(currentHeight - targetHeight) > 1) {
            var scaleX = (targetWidth / currentWidth) * 100;
            var scaleY = (targetHeight / currentHeight) * 100;
            var uniformScale = Math.min(scaleX, scaleY);
            newLayer.resize(uniformScale, uniformScale, AnchorPosition.TOPLEFT);
        }
        var finalBounds = newLayer.bounds;
        var finalWidth = finalBounds[2].value - finalBounds[0].value;
        var finalHeight = finalBounds[3].value - finalBounds[1].value;
        var centerX = x1 + (targetWidth / 2);
        var centerY = y1 + (targetHeight / 2);
        var currentCenterX = finalBounds[0].value + (finalWidth / 2);
        var currentCenterY = finalBounds[1].value + (finalHeight / 2);
        var dx = centerX - currentCenterX;
        var dy = centerY - currentCenterY;
        newLayer.translate(dx, dy);
        doc.selection.load(savedSelection);
        addLayerMask();
        doc.selection.deselect();
        savedSelection.remove();
    } catch(e) { alert("Placement error: " + e.message); }
}

// ===== PLACE RESULT but KEEP selection channel (tidak remove) =====
function placeResultInDocumentKeepSelection(doc, resultFile, x1, y1, x2, y2, savedSelection, layerName) {
    try {
        // buka file hasil lalu duplikasikan layer pertamanya ke doc target
        var resultDoc = app.open(resultFile);
        resultDoc.artLayers[0].duplicate(doc, ElementPlacement.PLACEATBEGINNING);
        resultDoc.close(SaveOptions.DONOTSAVECHANGES);

        // layer baru berada di index 0
        var newLayer = doc.artLayers[0];
        if (layerName && layerName.length) {
            newLayer.name = layerName;
        }

        // hitung scaling agar pas ke seleksi
        var targetWidth  = x2 - x1;
        var targetHeight = y2 - y1;
        var currentBounds  = newLayer.bounds;
        var currentWidth   = currentBounds[2].value - currentBounds[0].value;
        var currentHeight  = currentBounds[3].value - currentBounds[1].value;

        if (Math.abs(currentWidth - targetWidth) > 1 || Math.abs(currentHeight - targetHeight) > 1) {
            var scaleX = (targetWidth  / currentWidth)  * 100;
            var scaleY = (targetHeight / currentHeight) * 100;
            var uniformScale = Math.min(scaleX, scaleY);
            newLayer.resize(uniformScale, uniformScale, AnchorPosition.TOPLEFT);
        }

        // posisikan ke tengah area seleksi
        var finalBounds   = newLayer.bounds;
        var finalWidth    = finalBounds[2].value - finalBounds[0].value;
        var finalHeight   = finalBounds[3].value - finalBounds[1].value;
        var centerX = x1 + (targetWidth  / 2);
        var centerY = y1 + (targetHeight / 2);
        var currentCenterX = finalBounds[0].value + (finalWidth  / 2);
        var currentCenterY = finalBounds[1].value + (finalHeight / 2);
        var dx = centerX - currentCenterX;
        var dy = centerY - currentCenterY;
        newLayer.translate(dx, dy);

        // apply mask dari savedSelection tanpa menghapus channel
        doc.selection.load(savedSelection);
        addLayerMask();
        doc.selection.deselect();

        return newLayer;
    } catch (e) {
        alert("Placement (keep) error: " + e.message);
        return null;
    }
}


function selectAll() { app.activeDocument.selection.selectAll(); }
function copyMerged() { var idCpyM = charIDToTypeID("CpyM"); executeAction(idCpyM, undefined, DialogModes.NO); }

function addLayerMask() {
    try {
        var idMk = charIDToTypeID("Mk  ");
        var desc = new ActionDescriptor();
        var idNw = charIDToTypeID("Nw  ");
        var idChnl = charIDToTypeID("Chnl");
        desc.putClass(idNw, idChnl);
        var idAt = charIDToTypeID("At  ");
        var ref = new ActionReference();
        var idChnl2 = charIDToTypeID("Chnl");
        var idMsk = charIDToTypeID("Msk ");
        ref.putEnumerated(idChnl2, idChnl2, idMsk);
        desc.putReference(idAt, ref);
        var idUsng = charIDToTypeID("Usng");
        var idUsrM = charIDToTypeID("UsrM");
        var idRvlS = charIDToTypeID("RvlS");
        desc.putEnumerated(idUsng, idUsrM, idRvlS);
        executeAction(idMk, desc, DialogModes.NO);
    } catch(e) {}
}

// ===== MAIN FUNCTION =====
function main() {
    // Startup stays lightweight (no network)
    if (!app.documents.length) { alert("Please open an image in Photoshop first!"); return; }

    // Show UI immediately
    var dialog = createDialog();
    var result = dialog.show();
    if (result !== 1) return;

    // === Show immediate feedback to avoid "blank screen" ===
    var progress = createProgressWindow("Validation");
    progress.updateStatus("Preparing...", 3);

    // 1) Curl check AFTER Generate is clicked
    progress.updateStatus("Checking system tools...", 6);
    if (!checkCurlAvailable()) {
        progress.finish("curl missing");
        showCurlMissingDialog();
        return;
    }

    // 2) Lazy auth + verification with live status
    progress.updateStatus("Loading local token...", 10);
    var auth = loadAuth();

    if (!auth) {
        progress.updateStatus("Waiting for activation...", 12);
        progress.finish("Waiting for activation...");
        auth = ensureAuthOrPrompt();
        if (!auth) return;
        // Re-open progress after activation
        progress = createProgressWindow("Validation");
        progress.updateStatus("Validating access...", 20);
    } else {
        progress.updateStatus("Validating access...", 20);
        var verifyResp = postJson(CONFIG.BACKEND_BASE + "/verify.php", { name: auth.name, token: auth.token });
        if (!(verifyResp && verifyResp.indexOf('"ok":true') > -1)) {
            clearAuth();
            progress.updateStatus("Re-activation required...", 25);
            progress.finish("Re-activation required...");
            auth = ensureAuthOrPrompt();
            if (!auth) return;
            progress = createProgressWindow("Validation");
            progress.updateStatus("Validating access...", 30);
        }
    }

    // 3) Collect dialog inputs (already captured)
    var prompt = dialog.promptInput.text;
    var selectedModel = "Nano-Banana (Gemini)";
    var newDocument   = dialog.newDocCheckbox.value;
    var upscale       = dialog.upscaleCheckbox.value;
    var referenceFile = dialog.referenceFile;
    var useColor      = dialog.colorCheckbox.value;

    if (!prompt || !prompt.length) { progress.finish("Missing prompt"); alert("Please enter a prompt first!"); return; }
    if (!hasActiveSelection()) { progress.finish("No selection"); alert("Please make a selection first using any selection tool!"); return; }

    if (useColor && selectedModel.indexOf("Nano") > -1) {
        var color = app.foregroundColor;
        var hex = "#" + toHex(color.rgb.red) + toHex(color.rgb.green) + toHex(color.rgb.blue);
        prompt += " " + hex;
    }

    // Close validation progress window before heavy processing (processSelection shows its own)
    progress.finish("Ready");

    var wantHD = !!(dialog.hdCheckbox && dialog.hdCheckbox.value);
    $.writeln("[UI] wantHD = " + wantHD);

    // Proceed with main pipeline (this will open its own progress window)
    processSelection(prompt, selectedModel, newDocument, upscale, referenceFile, wantHD);
}
// ===== START SCRIPT =====
main();
// testManualDownload();
// main(); // comment ini dulu
