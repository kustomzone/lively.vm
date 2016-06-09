/*global System, beforeEach, afterEach, describe, it*/

import { expect } from "mocha-es6";
import { promise } from "lively.lang";

import { getSystem, removeSystem, moduleEnv, moduleRecordFor } from "lively.modules/src/system.js";
import { forgetModuleDeps } from "lively.modules/src/dependencies.js";
import { runEval } from "../index.js";

var dir = System.normalizeSync("lively.vm/tests/test-resources/"),
    testProjectDir = dir + "test-project-dir-1/",
    module1 = testProjectDir + "file1.js",
    module2 = testProjectDir + "file2.js",
    module3 = testProjectDir + "file3.js",
    module4 = testProjectDir + "file4.js";

describe("eval", () => {

  var S;
  beforeEach(function() {
    S = getSystem('test', { baseURL: dir });
    return S.import(module1);
  });

  afterEach(() => removeSystem("test"));

  it("inside of module", () =>
    runEval("1 + z + x", {System: S, targetModule: module1})
      .then(result => expect(result.value).equals(6)));

  it("sets this", async () => {
    var result = await runEval("1 + this.x", {System: S, targetModule: module1, context: {x: 2}});
    expect(result.value).equals(3);
  })

  it("of export statement", async () => {
    var [m1, m2] = await Promise.all([S.import(module1), S.import(module2)]);
    expect(m1.x).to.equal(3, "module1 initial x");
    expect(m2.y).to.equal(1, "module2 initial y");
      // Modify module1
    var result = await runEval("export var y = 2;", {asString: true, System: S, targetModule: module2});
    expect(result.value).to.not.match(/error/i);
    expect(m2.y).to.equal(2, "file2.js not updated");
    expect(m1.x).to.equal(4, "file1.js not updated after its dependency changed");
    var m1Reloaded = await S.import(module1);
    expect(m1Reloaded.x).to.equal(4, "module1 x");
    var m2Reloaded = await S.import(module2);
    expect(m2Reloaded.y).to.equal(2, "module2 y");
  });

  it("of var being exported", () =>
    promise.chain([
      () => Promise.all([S.import(module1), S.import(module2)]),
      ([m1, m2], state) => {
        state.m1 = m1; state.m2 = m2;
        expect(m1.x).to.equal(3);
        expect(m2.y).to.equal(1);
      },
        // Modify module1
      () => runEval("var y = 2;", {asString: true, System: S, targetModule: module2}),
      (result, {m1, m2}) => {
        expect(result.value).to.not.match(/error/i);
        expect(m2.y).to.equal(2, "file2.js not updated");
        expect(m1.x).to.equal(4, "file1.js not updated after its dependency changed");
        return Promise.all([
          S.import(module1).then(m => expect(m.x).to.equal(4)),
          S.import(module2).then(m => expect(m.y).to.equal(2)),
        ]);
      }]));

  it("of new var that is exported and then changes", () =>
    S.import(module1)
      // define a new var that is exported
      .then(_ => runEval("var zork = 1; export { zork }", {asString: true, System: S, targetModule: module1}))
      .then(() => expect(moduleRecordFor(S, module1).exports).to.have.property("zork", 1, "of record"))
      .then(() => S.import(module1).then(m1 => expect(m1).to.have.property("zork", 1, "of module")))
      // now change that var and see if the export is updated
      .then(() => runEval("var zork = 2;", {asString: true, System: S, targetModule: module1}))
      .then(() => expect(moduleRecordFor(S, module1).exports).to.have.property("zork", 2, "of record after change"))
      .then(() => S.import(module1).then(m1 => expect(m1).to.have.property("zork", 2, "of module after change")))
      );

  it("of export statement with new export", () =>
    promise.chain([
      () => () => Promise.all([S.import(module1), S.import(module2)]),
      (modules, state) => ([m1, m2], state) => { state.m1 = m1; state.m2 = m2; },
      () => runEval("export var foo = 3;", {asString: true, System: S, targetModule: module2}),
      (result, {m1, m2}) => {
        expect(result.value).to.not.match(/error/i);
        // Hmmm.... frozen modules require us to re-import... damn!
        // expect(state.m1.foo).to.equal(3, "foo not defined in module1 after eval");
        return S.import(module2)
          .then((m) => expect(m.foo).to.equal(3, "foo not defined after eval"))
      },
      () => runEval("export var foo = 5;", {asString: true, System: S, targetModule: module2}),
      (result, {m1, m2}) => {
        expect(result.value).to.not.match(/error/i);
        // expect(state.m1.foo).to.equal(5, "foo updated in module1 after re-eval");
        return S.import(module2)
          .then((m) => expect(m.foo).to.equal(5, "foo updated in module1 after re-eval"));
      }]));

  it("of import statement", () =>
    // test if import is transformed to lookup + if the imported module gets before eval
    promise.chain([
      () => runEval("import { z } from './file3.js'; z", {System: S, targetModule: testProjectDir + "file1.js"}),
      (result, state) => {
        expect(result.value).to.not.match(/error/i);
        expect(result.value).to.equal(1, "imported value");
      }]));


  it("reload module dependencies", async () => {
    var m = await S.import(module1);
    expect(m.x).to.equal(3);
    // we change module3 and check that the value of module1 that indirectly
    // depends on module3 has changed as well
    var source = await S.fetch({status: 'loading', address: module3, name: module3, linkSets: [], dependencies: [], metadata: {}});
    source = source.replace(/(z = )([0-9]+)/, "$12");
    var result = await runEval(source, {asString: true, System: S, targetModule: module3});
    expect(result.value).to.not.match(/error/i);
    forgetModuleDeps(S, module3);
    var m = await S.import(module1);
    expect(m.x).to.equal(4);
  });

  describe("es6 code", () => {

    it("**", () =>
      S.import(module1)
        .then(() => runEval("z ** 4", {System: S, targetModule: module1})
        .then(result => expect(result).property("value").to.equal(16))));

  });

  describe("async", () => {

    it("awaits async function", () =>
      S.import(module4)
        .then(() => runEval("await foo(3)", {System: S, targetModule: module4})
        .then(result => expect(result).property("value").to.equal(3))));

    it("nests await", () =>
      S.import(module4)
        .then(() => runEval("await ('a').toUpperCase()", {System: S, targetModule: module4})
        .then(result => expect(result).property("value").to.equal("A"))));

  });
});
