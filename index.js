import * as completions from "./lib/completions.js";
import * as cjs from "./lib/commonjs-interface.js";
import * as es6 from "./lib/es6-interface.js";


function bootstrap(configure) {
  return Promise.resolve()
    .then(() => {
      // // 1. remove bootVMs nodejs modules from loading cache, not its node_modules
      // // though!
      if (System.get("@system-env").node) {
        var cache = System._nodeRequire('module').Module._cache,
            toRemove = Object.keys(cache).filter(name => !name.match("node_modules"));
        toRemove.forEach(ea => delete cache[ea]);
      }
  
      // 2. configure
      es6._init(); // create a new System instance
      configure();
      es6.wrapModuleLoad();

      // 3. load the entire vm package minus node_modules via es6
      return es6.import("lively.vm/index.js")
    });
}

export * from "./lib/evaluator.js";
export { completions, cjs, es6, bootstrap }
