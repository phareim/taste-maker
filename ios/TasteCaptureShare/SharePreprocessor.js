/*
 * Runs inside the shared Safari page (wired via
 * NSExtensionJavaScriptPreprocessingFile) and hands the page's own context to
 * the extension. This is the iOS analog of the Chrome popup's
 * window.getSelection() injection, but it also scrapes the metadata the
 * creator-inference ladder needs — so a Safari share costs the Worker no
 * outbound fetch at all, and works on pages behind a login or paywall that a
 * server-side fetch could never see.
 */
var Preprocessor = function () {};

// Some sites emit hundreds of KB of JSON-LD; the extension has a modest memory
// ceiling and this all rides in an IPC payload, so cap what we hand over.
var MAX_JSONLD_CHARS = 64 * 1024;

var WANTED = /^(og:|twitter:|music:|article:|product:|author$|application-name$)/i;

Preprocessor.prototype = {
    run: function (args) {
        var selection = "";
        try {
            selection = window.getSelection ? window.getSelection().toString() : "";
        } catch (e) {
            selection = "";
        }

        var meta = {};
        try {
            var tags = document.getElementsByTagName("meta");
            for (var i = 0; i < tags.length; i++) {
                var key = tags[i].getAttribute("property") || tags[i].getAttribute("name");
                var content = tags[i].getAttribute("content");
                if (key && content && WANTED.test(key)) {
                    meta[key.toLowerCase()] = content;
                }
            }
        } catch (e) {}

        var jsonld = [];
        try {
            var scripts = document.querySelectorAll('script[type="application/ld+json"]');
            var budget = MAX_JSONLD_CHARS;
            for (var j = 0; j < scripts.length && budget > 0; j++) {
                var text = scripts[j].textContent || "";
                if (!text) continue;
                if (text.length > budget) text = text.substring(0, budget);
                budget -= text.length;
                jsonld.push(text);
            }
        } catch (e) {}

        args.completionFunction({
            title: document.title,
            url: document.URL,
            selection: selection,
            meta: meta,
            jsonld: jsonld,
        });
    },
};

var ExtensionPreprocessingJS = new Preprocessor();
