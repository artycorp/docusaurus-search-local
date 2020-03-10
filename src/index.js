const fs = require("fs");
const path = require("path");
const util = require("util");

const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);

const lunr = require("lunr");
require('lunr-languages/lunr.stemmer.support')(lunr);
require('lunr-languages/lunr.ru')(lunr);
require('lunr-languages/lunr.multi')(lunr);
const htmlparser2 = require("htmlparser2");

function html2text(html) {
  let pageTitle = "";
  const sections = [];
  let sectionTitle = "";
  let sectionContent = "";
  let hashLink = "";

  let insideMain = false;
  let insideArticle = false;
  let insideHeader = false;
  let insidePre = false;
  let insideH1 = false;
  let insideH2 = false;
  let insideH3 = false;
  let insideHashLink = false;
  let insideTitle = false;
  let insideSVG = false;

  function sectionEnd() {
    if (sections.length === 0) {
      return;
    }
    sections[sections.length - 1].content = sectionContent.trim();
    sectionContent = "";
  }

  function sectionStart() {
    sections.push({
      title: sectionTitle.trim(),
      hash: hashLink
    });
    sectionTitle = "";
  }

  const parser = new htmlparser2.Parser(
    {
      onopentag(tagname, attributes) {
        if (["h1", "h2", "h3"].includes(tagname)) {
          sectionEnd();
        }

        if (tagname === "main") {
          insideMain = true;
        } else if (tagname === "article") {
          insideArticle = true;
        } else if (tagname === "pre") {
          insidePre = true;
        } else if (tagname === "header") {
          insideHeader = true;
        } else if (tagname === "h1") {
          insideH1 = true;
        } else if (tagname === "h2") {
          insideH2 = true;
        } else if (tagname === "h3") {
          insideH3 = true;
        } else if (tagname === "a" && attributes["class"] === "hash-link") {
          insideHashLink = true;
          hashLink = attributes["href"];
        } else if (tagname === "title") {
          insideTitle = true;
        } else if (tagname === "svg") {
          insideSVG = true;
        }
      },
      ontext(text) {
        if (insideSVG) {
          return;
        }
        if (insideMain && !insideHashLink) {
          if (text.length) {
            if (insideH1 || insideH2 || insideH3) {
              sectionTitle += text;
            } else {
              sectionContent += text;
            }
          }
        } else if (insideTitle) {
          pageTitle += text;
        }
      },
      onclosetag(tagname) {
        if (tagname === "main") {
          insideMain = false;
        } else if (tagname === "article") {
          insideArticle = false;
        } else if (tagname === "pre") {
          insidePre = false;
        } else if (tagname === "header") {
          insideHeader = false;
        } else if (tagname === "h1") {
          insideH1 = false;
        } else if (tagname === "h2") {
          insideH2 = false;
        } else if (tagname === "h3") {
          insideH3 = false;
        } else if (tagname === "a" && insideHashLink) {
          insideHashLink = false;
        } else if (tagname === "title") {
          insideTitle = false;
        } else if (tagname === "svg") {
          insideSVG = false;
        }

        if (insideMain && ["h1", "h2", "h3"].includes(tagname)) {
          if (insideArticle && insideHeader) {
            pageTitle = sectionTitle.trim();
          }
          sectionStart();
        } else if (!insidePre) {
          sectionTitle += " ";
          sectionContent += " ";
        }
      }
    },
    { decodeEntities: true, lowerCaseTags: true }
  );
  parser.write(html);
  parser.end();

  sectionEnd();

  return { pageTitle, sections };
}

module.exports = function(context, options) {
  return {
    name: 'docusaurus-plugin',
    getThemePath() {
      return path.resolve(__dirname, './theme');
    },
    async postBuild({ routesPaths = [], outDir, baseUrl }) {
      const data = routesPaths.map(route => {
        let file = route;
        if (file.startsWith(baseUrl)) {
          file = file.replace(baseUrl, "");
        }
        if (!file.endsWith(".html")) {
          if (!file.endsWith("/")) {
            file += "/";
          }
          file += "index.html";
        }
        file = path.join(outDir, file);

        return {
          file,
          route
        };
      });

      // Give every index entry a unique id so that the index does not need to store long URLs.
      let nextDocId = 1;
      const documents = (await Promise.all(data.map(async ({ file, route }) => {
        const html = await readFileAsync(file, { encoding: "utf8" });

        const { pageTitle, sections } = html2text(html);

        return sections.map(section => ({
          id: nextDocId++,
          pageTitle,
          pageRoute: route,
          sectionRoute: route + section.hash,
          sectionTitle: section.title,
          sectionContent: section.content
        }));
      }))).reduce((acc, val) => acc.concat(val), []); // .flat()

      const index = lunr(function () {
	this.use(lunr.multiLanguage('en', 'ru'));
        this.ref("id");
        this.field("title");
        this.field("content");
        documents.forEach(function ({ id, sectionTitle, sectionContent }) {
          this.add({
            id: id.toString(), // the ref must be a string
            title: sectionTitle,
            content: sectionContent
          });
        }, this)
      });

      await writeFileAsync(
        path.join(outDir, "search-index.json"),
        JSON.stringify({
          documents: documents.map(({ id, pageTitle, sectionTitle, sectionRoute }) => ({ id, pageTitle, sectionTitle, sectionRoute })),
          index
        }),
        { encoding: "utf8" }
      );
    },
  };
};
