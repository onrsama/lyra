#target photoshop
app.bringToFront();
/*
    Lyra - Ruparaya AI_Launcher.jsx
    Purpose: a stable menu target for Actions. When played (e.g. Shift+F4 Action),
            it locates and runs your real Ruparaya script from Presets/Scripts.
    HOW YOU SHARE:
    - Record an Action that calls this launcher via "Insert Menu Item" (File > Scripts > Ruparaya_Launcher)
    - Save Actions to .ATN and share that .ATN only. Recipients will just Load Actions (.ATN).
*/

// === CONFIG: set your real script filename here ===
var TARGET_SCRIPT = "Lyra - Ruparaya AI.jsx"; // change if needed
// ================================================

function findScriptsFolder() {
    try {
        var f = new Folder(Folder.appPackage.fsName + "/Presets/Scripts");
        if (f.exists) return f;
    } catch (e) {}
    try {
        var f2 = new Folder(app.path + "/Presets/Scripts");
        if (f2.exists) return f2;
    } catch (e2) {}
    return null;
}

function runTargetScript() {
    var scriptsFolder = findScriptsFolder();
    var targetFile = null;

    if (scriptsFolder) {
        var f = File(scriptsFolder.fsName + "/" + TARGET_SCRIPT);
        if (f.exists) targetFile = f;
    }
    if (!targetFile) {
        alert("Ruparaya launcher could not locate the target script:\n" + TARGET_SCRIPT +
                "\n\nPut the script into Presets/Scripts and restart Photoshop,\n"+
                "or update TARGET_SCRIPT in Ruparaya_Launcher.jsx.");
        return;
    }

    try {
        $.evalFile(targetFile);
    } catch (err) {
        alert("Failed to run target script:\n" + err);
    }
}

runTargetScript();
