'use strict';

// Interface languages. Kitty's code is written in Brazilian Portuguese: every
// text the person sees goes through t() (main process) or kitty.t / kittyUI.t
// (kitty:// pages and the browser UI, which also translate their static HTML),
// and each locale file maps that Portuguese text to its own language. A text
// missing from a locale shows in Portuguese.
//
// To add a language: copy en.json to <code>.json (a BCP 47 code, such as es or
// fr), translate the values, keep the {placeholders}, and add it to LANGUAGES.

/** Language code → its name in that language, in the order they are offered. */
const LANGUAGES = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
};
const DEFAULT_LANGUAGE = 'en';
const SOURCE_LANGUAGE = 'pt-BR';

let current = DEFAULT_LANGUAGE;
let dict = {};

function setLanguage(code) {
  current = code in LANGUAGES ? code : DEFAULT_LANGUAGE;
  dict = current === SOURCE_LANGUAGE ? {} : require(`./${current}.json`);
}

function language() {
  return current;
}

/** The translation of a Portuguese text, with {name} placeholders filled from vars. */
function t(text, vars) {
  const out = Object.prototype.hasOwnProperty.call(dict, text) ? dict[text] : text;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : out;
}

/** What the renderers need to translate on their own. */
function snapshot() {
  return { lang: current, dict };
}

setLanguage(DEFAULT_LANGUAGE);

module.exports = { LANGUAGES, DEFAULT_LANGUAGE, setLanguage, language, t, snapshot };
