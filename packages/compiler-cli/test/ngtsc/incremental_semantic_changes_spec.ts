/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {runInEachFileSystem} from '../../src/ngtsc/file_system/testing';
import {loadStandardTestFiles} from '../../src/ngtsc/testing';

import {NgtscTestEnvironment} from './env';

const testFiles = loadStandardTestFiles();

runInEachFileSystem(() => {
  fdescribe('ngtsc incremental compilation (semantic changes)', () => {
    let env!: NgtscTestEnvironment;

    beforeEach(() => {
      env = NgtscTestEnvironment.setup(testFiles);
      env.enableMultipleCompilations();
      env.tsconfig();
    });

    function expectToHaveWritten(files: string[]): void {
      const set = env.getFilesWrittenSinceLastFlush();

      const expectedSet = new Set<string>();
      for (const file of files) {
        expectedSet.add(file);
        expectedSet.add(file.replace(/\.js$/, '.d.ts'));
      }

      expect(set).toEqual(expectedSet);

      // Reset for the next compilation.
      env.flushWrittenFileTracking();
    }

    describe('changes to public api', () => {
      it('should not recompile dependent components when public api is unchanged', () => {
        setupDeepModule(env);
        setupAppModule(env);

        env.driveMain();
        env.flushWrittenFileTracking();

        env.write('app/cmp-b.ts', `
            import {Component, Input, Output, EventEmitter} from '@angular/core';

            @Component({
              selector: 'app-cmp-b',
              template: '<div dir>{{ 1 | pipe }}</div>',
            })
            export class AppCmpB {
              @Input('app-cmp-b-in') input: string;
              @Output('app-cmp-b-out') output = new EventEmitter<number>(); // <-- changed to number
            }
          `);
        env.driveMain();
        expectToHaveWritten([
          // AppMod is written because it has a direct reference to AppCmpB.
          '/app/mod.js',

          // AppCmpB is written because it was updated.
          '/app/cmp-b.js',

          // Nothing else is written because the public API of AppCmpB was not affected
        ]);
      });

      it('should not recompile components that do not use a changed directive', () => {
        setupDeepModule(env);
        setupAppModule(env);

        env.driveMain();
        env.flushWrittenFileTracking();

        env.write('app/cmp-b.ts', `
             import {Component, Input, Output, EventEmitter} from '@angular/core';

             @Component({
               selector: 'app-cmp-b',
               template: '<div dir>{{ 1 | pipe }}</div>',
             })
             export class AppCmpB {
               @Input('app-cmp-b-in') input: string;
               @Output('app-cmp-b-out-renamed') output = new EventEmitter<number>(); // <-- renamed
             }
           `);
        env.driveMain();
        expectToHaveWritten([
          // AppMod is written because it has a direct reference to AppCmpB.
          '/app/mod.js',

          // AppCmpB is written because it was updated.
          '/app/cmp-b.js',

          // AppCmpA is written because it uses AppCmpB, for which the public API was affected.
          '/app/cmp-a.js',

          // In particular AppCmpC should not be written because it does not use AppCmpB.
        ]);
      });

      it('should recompile components for which a directive usage is introduced', () => {
        setupDeepModule(env);
        setupAppModule(env);

        env.driveMain();
        env.flushWrittenFileTracking();

        env.write('app/dir-b.ts', `
             import {Directive} from '@angular/core';

             @Directive({
               selector: '[dir]',
             })
             export class AppDirB {
             }
           `);
        env.write('app/mod.ts', `
             import {NgModule} from '@angular/core';
             import {DeepMod} from '../deep/mod';
             import {AppDir} from './dir';
             import {AppCmpA} from './cmp-a';
             import {AppCmpB} from './cmp-b';
             import {AppCmpC} from './cmp-c';
             import {AppPipe} from './pipe';
             import {AppDirB} from './dir-b';

             @NgModule({
               declarations: [AppDir, AppDirB, AppCmpA, AppCmpB, AppCmpC, AppPipe], // <-- AppDirB added
               imports: [DeepMod],
             })
             export class AppMod {}
           `);
        env.driveMain();
        expectToHaveWritten([
          // AppMod is written because it was updated.
          '/app/mod.js',

          // AppDirB is written because it was added.
          '/app/dir-b.js',

          // AppCmpB and AppCmpB are written because they match the selector of AppDirB.
          '/app/cmp-b.js', '/app/cmp-c.js',

          // In particular AppCmpA should not be written because it does not use AppDirB.
        ]);
      });

      it('should recompile components for which a directive usage is removed', () => {
        setupDeepModule(env);
        setupAppModule(env);

        env.driveMain();
        env.flushWrittenFileTracking();

        env.write('app/mod.ts', `
             import {NgModule} from '@angular/core';
             import {DeepMod} from '../deep/mod';
             import {AppCmpA} from './cmp-a';
             import {AppCmpB} from './cmp-b';
             import {AppCmpC} from './cmp-c';
             import {AppPipe} from './pipe';

             @NgModule({
               declarations: [AppCmpA, AppCmpB, AppCmpC, AppPipe], // <-- AppDir removed
               imports: [DeepMod],
             })
             export class AppMod {}
           `);
        env.driveMain();
        expectToHaveWritten([
          // AppMod is written because it was updated.
          '/app/mod.js',

          // AppCmpB and AppCmpB are written because they used to match the selector of AppDir, but
          // it was removed.
          '/app/cmp-b.js', '/app/cmp-c.js',

          // In particular AppCmpA should not be written because it did not use AppDir.
        ]);
      });

      it('should recompile dependent components when an input is added', () => {
        setupDeepModule(env);
        setupAppModule(env);

        env.driveMain();
        env.flushWrittenFileTracking();

        env.write('app/cmp-b.ts', `
             import {Component, Input, Output, EventEmitter} from '@angular/core';

             @Component({
               selector: 'app-cmp-b',
               template: '<div dir>{{ 1 | pipe }}</div>',
             })
             export class AppCmpB {
               @Input('app-cmp-b-in') input: string;
               @Input('app-cmp-b-in-added') added: string; // <-- added
               @Output('app-cmp-b-out') output = new EventEmitter<void>();
             }
           `);
        env.driveMain();
        expectToHaveWritten([
          // AppMod is written because it has a direct reference to AppCmpB, which was updated.
          '/app/mod.js',

          // AppCmpB is written because it was updated.
          '/app/cmp-b.js',

          // AppCmpA is written because it uses AppCmpB for which an input was added.
          '/app/cmp-a.js',

          // In particular AppCmpC should not be written because it did not use AppCmpB.
        ]);
      });

      it('should recompile dependent components when an input is renamed', () => {
        setupDeepModule(env);
        setupAppModule(env);

        env.driveMain();
        env.flushWrittenFileTracking();

        env.write('app/cmp-b.ts', `
             import {Component, Input, Output, EventEmitter} from '@angular/core';

             @Component({
               selector: 'app-cmp-b',
               template: '<div dir>{{ 1 | pipe }}</div>',
             })
             export class AppCmpB {
               @Input('app-cmp-b-in-renamed') input: string; // <-- renamed
               @Output('app-cmp-b-out') output = new EventEmitter<void>();
             }
           `);
        env.driveMain();
        expectToHaveWritten([
          // AppMod is written because it has a direct reference to AppCmpB, which was updated.
          '/app/mod.js',

          // AppCmpB is written because it was updated.
          '/app/cmp-b.js',

          // AppCmpA is written because it uses AppCmpB for which an input was renamed.
          '/app/cmp-a.js',

          // In particular AppCmpC should not be written because it did not use AppCmpB.
        ]);
      });

      it('should recompile dependent components when an input is removed', () => {
        setupDeepModule(env);
        setupAppModule(env);

        env.driveMain();
        env.flushWrittenFileTracking();

        env.write('app/cmp-b.ts', `
             import {Component, Input, Output, EventEmitter} from '@angular/core';

             @Component({
               selector: 'app-cmp-b',
               template: '<div dir>{{ 1 | pipe }}</div>',
             })
             export class AppCmpB {
               // @Input('app-cmp-b-in') input: string; // <-- commented out
               @Output('app-cmp-b-out') output = new EventEmitter<void>();
             }
           `);
        env.driveMain();
        expectToHaveWritten([
          // AppMod is written because it has a direct reference to AppCmpB, which was updated.
          '/app/mod.js',

          // AppCmpB is written because it was updated.
          '/app/cmp-b.js',

          // AppCmpA is written because it uses AppCmpB for which an input was removed.
          '/app/cmp-a.js',

          // In particular AppCmpC should not be written because it did not use AppCmpB.
        ]);
      });

      it('should recompile dependent components when an output is added', () => {
        setupDeepModule(env);
        setupAppModule(env);

        env.driveMain();
        env.flushWrittenFileTracking();

        env.write('app/cmp-b.ts', `
             import {Component, Input, Output, EventEmitter} from '@angular/core';

             @Component({
               selector: 'app-cmp-b',
               template: '<div dir>{{ 1 | pipe }}</div>',
             })
             export class AppCmpB {
               @Input('app-cmp-b-in') input: string;
               @Output('app-cmp-b-out') output = new EventEmitter<void>();
               @Output('app-cmp-b-out-added') added: string; // <-- added
             }
           `);
        env.driveMain();
        expectToHaveWritten([
          // AppMod is written because it has a direct reference to AppCmpB, which was updated.
          '/app/mod.js',

          // AppCmpB is written because it was updated.
          '/app/cmp-b.js',

          // AppCmpA is written because it uses AppCmpB for which an output was added.
          '/app/cmp-a.js',

          // In particular AppCmpC should not be written because it did not use AppCmpB.
        ]);
      });

      it('should recompile dependent components when an output is renamed', () => {
        setupDeepModule(env);
        setupAppModule(env);

        env.driveMain();
        env.flushWrittenFileTracking();

        env.write('app/cmp-b.ts', `
             import {Component, Input, Output, EventEmitter} from '@angular/core';

             @Component({
               selector: 'app-cmp-b',
               template: '<div dir>{{ 1 | pipe }}</div>',
             })
             export class AppCmpB {
               @Input('app-cmp-b-in') input: string;
               @Output('app-cmp-b-out-renamed') output = new EventEmitter<void>(); // <-- renamed
             }
           `);
        env.driveMain();
        expectToHaveWritten([
          // AppMod is written because it has a direct reference to AppCmpB, which was updated.
          '/app/mod.js',

          // AppCmpB is written because it was updated.
          '/app/cmp-b.js',

          // AppCmpA is written because it uses AppCmpB for which an output was renamed.
          '/app/cmp-a.js',

          // In particular AppCmpC should not be written because it did not use AppCmpB.
        ]);
      });

      it('should recompile dependent components when an output is removed', () => {
        setupDeepModule(env);
        setupAppModule(env);

        env.driveMain();
        env.flushWrittenFileTracking();

        env.write('app/cmp-b.ts', `
             import {Component, Input, Output, EventEmitter} from '@angular/core';

             @Component({
               selector: 'app-cmp-b',
               template: '<div dir>{{ 1 | pipe }}</div>',
             })
             export class AppCmpB {
               @Input('app-cmp-b-in') input: string;
               // @Output('app-cmp-b-out') output = new EventEmitter<void>(); // <-- commented out
             }
           `);
        env.driveMain();
        expectToHaveWritten([
          // AppMod is written because it has a direct reference to AppCmpB, which was updated.
          '/app/mod.js',

          // AppCmpB is written because it was updated.
          '/app/cmp-b.js',

          // AppCmpA is written because it uses AppCmpB for which an output was removed.
          '/app/cmp-a.js',

          // In particular AppCmpC should not be written because it did not use AppCmpB.
        ]);
      });

      it('should recompile dependent components when exportAs clause changes', () => {
        setupDeepModule(env);
        setupAppModule(env);

        env.driveMain();
        env.flushWrittenFileTracking();

        env.write('app/dir.ts', `
             import {Directive, Input, Output, EventEmitter} from '@angular/core';

             @Directive({
               selector: '[dir]',
               exportAs: 'dir', // <-- added
             })
             export class AppDir {
               @Input('dir-in') input: string;
               @Output('dir-out') output = new EventEmitter<void>();
             }
           `);
        env.driveMain();
        expectToHaveWritten([
          // AppMod is written because it has a direct reference to AppCmpB, which was updated.
          '/app/mod.js',

          // AppDir is written because it was updated.
          '/app/dir.js',

          // AppCmpB and AppCmpC are written because they use AppDir, which had its exportAs clause
          // changed.
          '/app/cmp-b.js', '/app/cmp-c.js',

          // In particular AppCmpA should not be written because it did not use AppDir.
        ]);
      });

      it('should recompile components when a pipe is newly matched because it was renamed', () => {
        setupDeepModule(env);
        setupAppModule(env);

        env.driveMain();
        env.flushWrittenFileTracking();

        env.write('app/pipe.ts', `
            import {Pipe} from '@angular/core';

            @Pipe({
              name: 'pipe-renamed', // <-- renamed
            })
            export class AppPipe {}
          `);
        env.driveMain();
        expectToHaveWritten([
          // AppMod is written because it has a direct reference to AppPipe, which was updated.
          '/app/mod.js',

          // AppPipe is written because it was updated.
          '/app/pipe.js',

          // AppCmpB and AppCmpC are written because they used AppPipe which no longer matches.
          '/app/cmp-b.js', '/app/cmp-c.js',

          // AppCmpA should not be written because it does not use AppPipe.
        ]);
      });
    });

    describe('external declarations', () => {
      it('should not recompile components that use external declarations that are not changed',
         () => {
           env.write('node_modules/external/index.d.ts', `
             import * as ng from '@angular/core';

             export declare class ExternalDir {
               static ɵdir: ɵɵDirectiveDefWithMeta<ExternalDir, "[external]", never, {}, {}, never>;
             }

             export declare class ExternalMod {
               static ɵmod: ɵɵNgModuleDefWithMeta<ExternalMod, [typeof ExternalDir], never, [typeof ExternalDir]>;
             }
           `);
           env.write('cmp-a.ts', `
             import {Component} from '@angular/core';

             @Component({
               template: '<div external></div>',
             })
             export class MyCmpA {}
           `);
           env.write('cmp-b.ts', `
             import {Component} from '@angular/core';

             @Component({
               template: '<div external></div>',
             })
             export class MyCmpB {}
           `);
           env.write('mod.ts', `
             import {NgModule} from '@angular/core';
             import {ExternalMod} from 'external';
             import {MyCmpA} from './cmp-a';
             import {MyCmpB} from './cmp-b';

             @NgModule({
               declarations: [MyCmpA, MyCmpB],
               imports: [ExternalMod],
             })
             export class MyMod {}
           `);
           env.driveMain();
           env.flushWrittenFileTracking();

           env.invalidateCachedFile('cmp-a.ts');
           env.driveMain();
           expectToHaveWritten([
             // MyMod is written because it has a direct reference to MyCmpA, which was invalidated.
             '/mod.js',

             // MyCmpA is written because it was invalidated.
             '/cmp-a.js',

             // MyCmpB should not be written because it is unaffected.
           ]);
         });

      it('should recompile components once an external declaration is changed',
         () => {

         });
    });

    describe('symbol identity', () => {
      it('should recompile components that use a directive declared inside a function',
         () => {

         });

      it('should recompile components when their exported name changes',
         () => {

         });

      it('should not recompile components when a directive is changed into a component',
         () => {

         });

      it('should recompile components when a directive is changed into a pipe',
         () => {

         });

      it('should recompile components when a directive is changed into an NgModule',
         () => {

         });

      it('should not recompile components when a component is changed into a directive',
         () => {

         });

      it('should recompile components when a component is changed into a pipe',
         () => {

         });

      it('should recompile components when a component is changed into an NgModule',
         () => {

         });

      it('should recompile components when a pipe is changed into a directive',
         () => {

         });

      it('should recompile components when a pipe is changed into a component',
         () => {

         });

      it('should recompile components when a pipe is changed into an NgModule',
         () => {

         });
    });

    describe('remote scoping', () => {
      it('should not recompile an NgModule nor component when remote scoping is unaffected', () => {
        env.write('cmp-a-template.html', `<cmp-b><cmp-b>`);
        env.write('cmp-a.ts', `
             import {Component} from '@angular/core';

             @Component({
               selector: 'cmp-a',
               templateUrl: './cmp-a-template.html',
             })
             export class MyCmpA {}
           `);
        env.write('cmp-b-template.html', `<cmp-a><cmp-a>`);
        env.write('cmp-b.ts', `
             import {Component} from '@angular/core';

             @Component({
               selector: 'cmp-b',
               templateUrl: './cmp-b-template.html',
             })
             export class MyCmpB {}
           `);
        env.write('mod.ts', `
             import {NgModule} from '@angular/core';
             import {MyCmpA} from './cmp-a';
             import {MyCmpB} from './cmp-b';

             @NgModule({
               declarations: [MyCmpA, MyCmpB],
             })
             export class MyMod {}
           `);
        env.driveMain();
        env.flushWrittenFileTracking();

        env.write('cmp-b-template.html', `<cmp-a>Update</cmp-a>`);
        env.driveMain();
        expectToHaveWritten([
          // MyCmpB is written because it was updated.
          '/cmp-b.js',

          // MyCmpA and MyMod should not be written because they are not affected.
        ]);
      });

      it('should recompile an NgModule and component when an import cycle is introduced', () => {
        env.write('cmp-a-template.html', ``);
        env.write('cmp-a.ts', `
             import {Component} from '@angular/core';

             @Component({
               selector: 'cmp-a',
               templateUrl: './cmp-a-template.html',
             })
             export class MyCmpA {}
           `);
        env.write('cmp-b-template.html', `<cmp-a><cmp-a>`);
        env.write('cmp-b.ts', `
             import {Component} from '@angular/core';

             @Component({
               selector: 'cmp-b',
               templateUrl: './cmp-b-template.html',
             })
             export class MyCmpB {}
           `);
        env.write('mod.ts', `
             import {NgModule} from '@angular/core';
             import {MyCmpA} from './cmp-a';
             import {MyCmpB} from './cmp-b';

             @NgModule({
               declarations: [MyCmpA, MyCmpB],
             })
             export class MyMod {}
           `);
        env.driveMain();
        env.flushWrittenFileTracking();

        env.write('cmp-a-template.html', `<cmp-b><cmp-b>`);
        env.driveMain();
        expectToHaveWritten([
          // MyMod is written because it needs remote scoping.
          '/mod.js',

          // MyCmpA is written because it was updated.
          '/cmp-a.js',

          // MyCmpB is written because it needs remote scoping.
          '/cmp-b.js',
        ]);
      });

      it('should recompile an NgModule and component when an import cycle is removed', () => {
        env.write('cmp-a-template.html', `<cmp-b><cmp-b>`);
        env.write('cmp-a.ts', `
             import {Component} from '@angular/core';

             @Component({
               selector: 'cmp-a',
               templateUrl: './cmp-a-template.html',
             })
             export class MyCmpA {}
           `);
        env.write('cmp-b-template.html', `<cmp-a><cmp-a>`);
        env.write('cmp-b.ts', `
             import {Component} from '@angular/core';

             @Component({
               selector: 'cmp-b',
               templateUrl: './cmp-b-template.html',
             })
             export class MyCmpB {}
           `);
        env.write('mod.ts', `
             import {NgModule} from '@angular/core';
             import {MyCmpA} from './cmp-a';
             import {MyCmpB} from './cmp-b';

             @NgModule({
               declarations: [MyCmpA, MyCmpB],
             })
             export class MyMod {}
           `);
        env.driveMain();
        env.flushWrittenFileTracking();

        env.write('cmp-a-template.html', ``);
        env.driveMain();
        expectToHaveWritten([
          // MyMod is written because it no longer needs remote scoping.
          '/mod.js',

          // MyCmpA is written because it was updated.
          '/cmp-a.js',

          // MyCmpB is written because it no longer needs remote scoping.
          '/cmp-b.js',
        ]);
      });
    });

    describe('NgModule declarations', () => {
      it('should recompile components when a matching directive is added in the direct scope',
         () => {

         });

      it('should recompile components when a matching directive is removed from the direct scope',
         () => {

         });

      it('should recompile components when a matching directive is added in the transitive scope',
         () => {

         });

      it('should recompile components when a matching directive is removed from the transitive scope',
         () => {

         });

      it('should not recompile components when a mismatched directive is added in scope',
         () => {

         });

      it('should not recompile components when a matching directive is added outside scope',
         () => {

         });
    });

    describe(
        'error recovery',
        () => {
            // ...
        });
  });
});

function setupDeepModule(env: NgtscTestEnvironment) {
  env.write('deep/dir.ts', `
    import {Directive} from '@angular/core';

    @Directive({
      selector: '[dir]',
    })
    export class DeepDir {}
  `);
  env.write('deep/cmp.ts', `
    import {Component} from '@angular/core';

    @Component({
      selector: 'deep-cmp',
      template: ''
    })
    export class DeepCmp {}
  `);
  env.write('deep/pipe.ts', `
    import {Pipe} from '@angular/core';

    @Pipe({
      name: 'pipe',
    })
    export class DeepPipe {}
  `);
  env.write('deep/mod.ts', `
    import {NgModule} from '@angular/core';
    import {DeepDir} from './dir';
    import {DeepCmp} from './cmp';
    import {DeepPipe} from './pipe';

    @NgModule({
      declarations: [DeepDir, DeepCmp, DeepPipe],
      exports: [DeepDir, DeepCmp, DeepPipe],
    })
    export class DeepMod {}
  `);
}

function setupAppModule(env: NgtscTestEnvironment) {
  env.write('app/dir.ts', `
    import {Directive, Input, Output, EventEmitter} from '@angular/core';

    @Directive({
      selector: '[dir]',
    })
    export class AppDir {
      @Input('dir-in') input: string;
      @Output('dir-out') output = new EventEmitter<void>();
    }
  `);
  env.write('app/cmp-a.ts', `
    import {Component} from '@angular/core';

    @Component({
      selector: 'app-cmp-a',
      template: '<app-cmp-b></app-cmp-b>',
    })
    export class AppCmpA {}
  `);
  env.write('app/cmp-b.ts', `
    import {Component, Input, Output, EventEmitter} from '@angular/core';

    @Component({
      selector: 'app-cmp-b',
      template: '<div dir>{{ 1 | pipe }}</div>',
    })
    export class AppCmpB {
      @Input('app-cmp-b-in') input: string;
      @Output('app-cmp-b-out') output = new EventEmitter<void>();
    }
  `);
  env.write('app/cmp-c.ts', `
    import {Component} from '@angular/core';

    @Component({
      selector: 'app-cmp-c',
      template: '<deep-cmp dir>{{ 1 | pipe }}</deep-cmp>',
    })
    export class AppCmpC {}
  `);
  env.write('app/pipe.ts', `
    import {Pipe} from '@angular/core';

    @Pipe({
      name: 'pipe',
    })
    export class AppPipe {}
  `);
  env.write('app/mod.ts', `
    import {NgModule} from '@angular/core';
    import {DeepMod} from '../deep/mod';
    import {AppDir} from './dir';
    import {AppCmpA} from './cmp-a';
    import {AppCmpB} from './cmp-b';
    import {AppCmpC} from './cmp-c';
    import {AppPipe} from './pipe';

    @NgModule({
      declarations: [AppDir, AppCmpA, AppCmpB, AppCmpC, AppPipe],
      imports: [DeepMod],
    })
    export class AppMod {}
  `);
}
