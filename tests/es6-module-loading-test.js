/*global process, before, beforeEach, afterEach, describe, it, expect*/

var env = typeof module !== "undefined" && module.require ? module.require("../env") : window;
var chai = env.isCommonJS ? module.require("chai") : window.chai;
var chaiSubset = env.isCommonJS ? module.require("chai-subset") : window.chaiSubset;
var expect = chai.expect; chaiSubset && chai.use(chaiSubset);
var lang = env.lively.lang || lively.lang, vm = env.isCommonJS ? require('../index') : lively.vm;
var Global = env.Global;
// if (typeof mocha === "undefined") {
//     var mocha = global.mocha = new (require("mocha"))();
//     mocha.suite.emit('pre-require', global, __filename, mocha);
//     mocha.suite.emit('require', module.exports, __filename, mocha);
//     mocha.suite.emit('post-require', global, __filename, mocha);
//     // mocha.run()
// }

var es6 = vm.es6;

var module1 = "test-resources/some-es6-module.js";
var module2 = "test-resources/another-es6-module.js";
var module3 = "test-resources/yet-another-es6-module.js";

describe("es6 modules", () => {

  before(function() {
    if (typeof require === "function") {
      // vm.cjs.reloadModule(vm.cjs.resolve("systemjs"));
      es6.config({baseURL: 'tests/'});
    } else {
      es6.config({
        transpiler: 'babel', babelOptions: {},
        baseURL: document.URL.replace(/\/[^\/]*$/, ""),
        map: {babel: '../node_modules/babel-core/browser.js'}
      });
    }
    es6.wrapModuleLoad();
  });

  afterEach(() => {
    es6.forgetModule(module1);
    es6.forgetModule(module2);
    es6.forgetModule(module3);
  });

  it("can be loaded", () =>
    es6.import(module1).then(m => expect(m.x).equals(3)));

  it("captures internal module state", () =>
    Promise.all([es6.import(module1), es6.resolve(module1)])
      .then((exportsAndName) =>
        expect(es6.envFor(exportsAndName[1]))
          .deep.property('recorder.internalState').equals(1)));


  describe("eval", () => {

    it("inside of module", () =>
      es6.runEval("2 + internalState", {targetModule: module1})
        .then(result => expect(result.value).equals(3)));

    it("of export statement", () =>
      // Load module1 and module2 which depends on module1
      lang.promise.chain([
        () => Promise.all([es6.import(module1), es6.import(module2)]),
        (modules, state) => {
          state.m1 = modules[0]; state.m2 = modules[1];
          expect(state.m1.x).to.equal(3);
          expect(state.m2.y).to.equal(5);
        },
          // Modify module1
        () => es6.runEval("export var x = 9;", {asString: true, targetModule: module1}),
        (result, state) => {
          expect(result.value).to.not.match(/error/i);
          expect(state.m1.x).to.equal(9, "module1 not updated");
          expect(state.m2.y).to.equal(11, "module2 not updated after its dependency changed");
          return Promise.all([
            es6.import(module1).then(m => expect(m.x).to.equal(9)),
            es6.import(module2).then(m => expect(m.y).to.equal(11)),
          ]);
        }]));

    it("of export statement with new export", () =>
      lang.promise.chain([
        () => Promise.all([es6.import(module1), es6.import(module2)]),
        (modules, state) => { state.m1 = modules[0]; state.m2 = modules[1]; },
        () => es6.runEval("export var foo = 3;", {asString: true, targetModule: module1}),
        (result, state) => {
          expect(result.value).to.not.match(/error/i);
          // Hmmm.... frozen modules require us to re-import... damn!
          // expect(state.m1.foo).to.equal(3, "foo not defined in module1 after eval");
          return es6.import(module1)
            .then((m1) => expect(m1.foo).to.equal(3, "foo not defined in module1 after eval"))
        },
        () => es6.runEval("export var foo = 5;", {asString: true, targetModule: module1}),
        (result, state) => {
          expect(result.value).to.not.match(/error/i);
          // expect(state.m1.foo).to.equal(5, "foo updated in module1 after re-eval");
          return es6.import(module1)
            .then((m1) => expect(m1.foo).to.equal(5, "foo updated in module1 after re-eval"))
        }]));

    it("of import statement", () =>
      // test if import is transformed to lookup + if the imported module gets before eval
      lang.promise.chain([
        () => es6.runEval("import {y} from './another-es6-module.js'; y", {targetModule: module1}),
        (result, state) => {
          expect(result.value).to.not.match(/error/i);
          expect(result.value).to.equal(5, "imported value");
        }]))
  });

  describe("dependencies", () => {

    it("computes required modules of some module", () =>
      es6.import(module3).then(() => {
        expect(es6.findRequirementsOf(module3)).to.deep.equal(
          [es6.resolve(module2), es6.resolve(module1)]);
      }));

    it("computes dependent modules of some module", () =>
      es6.import(module3).then(() => {
        expect(es6.findDependentsOf(module1)).to.deep.equal(
          [es6.resolve(module2), es6.resolve(module3)]);
        }));

  });

  describe("code changes", () => {

    function changeModule1Source() {
      // "internalState = 1" => "internalState = 2"
      return es6.sourceOf(module1).then(s =>
        es6.sourceChange(module1,
          s.replace(/(internalState = )([0-9]+)/, "$12"),
          {evaluate: true}));
    }

    it("modifies module and its exports", () =>
      es6.import(module1).then(m => {
        expect(es6.envFor(es6.resolve(module1)).recorder.internalState).to.equal(1, "internal state before change");
        expect(m.x).to.equal(3, "export state before change");
        return changeModule1Source().then(() => {
            expect(es6.envFor(es6.resolve(module1)).recorder.internalState).to.equal(2, "internal state after change");
            expect(m.x).to.equal(5, "export state after change");
        });
      }));

    it("modifies imports", () =>
      es6.import(module2)
        .then(() =>
          expect(es6._moduleRecordFor(es6.resolve(module2)).dependencies.map(ea => ea.name))
            .to.deep.equal([es6.resolve(module1)], "deps before"))
        .then(m => es6.sourceChange(module2,
                    "import { z as x } from './yet-another-es6-module.js'; export var y = x + 2;",
                    {evaluate: true}))
        .then(() =>
          expect(es6._moduleRecordFor(es6.resolve(module2)).dependencies.map(ea => ea.name))
              .to.deep.equal([es6.resolve(module3)], "deps after")));

    it("affects dependent modules", () =>
      es6.import(module2).then(m => {
        expect(m.y).to.equal(5, "before change");
        return changeModule1Source().then(() =>
          expect(m.y).to.equal(7, "state after change"));
        }));

    it("affects eval state", () =>
      es6.import(module1)
        .then(m => changeModule1Source())
        .then(() => es6.runEval("[internalState, x]", {targetModule: module1}))
        .then(result => expect(result.value).to.deep.equal([2, 5])));

    it("reload module dependencies", () =>
      es6.import(module3)
        .then(m => expect(m.z).to.equal(15))
        // we change module1 and check that the value of module3 that indirectly
        // depends on module1 has changed as well
        .then(() => es6.sourceOf(module1))
        // es6.sourceOf("tests/" + module1)
        .then(s => s.replace(/(internalState = )([0-9]+)/, "$12"))
        .then(s => es6.runEval(s, {asString: true, targetModule: module1}))
        .then(result => expect(result.value).to.not.match(/error/i))
        .then(() => es6.forgetModuleDeps(module1))
        .then(() => es6.import(module3))
        .then(m => expect(m.z).to.equal(21)));
  });

});