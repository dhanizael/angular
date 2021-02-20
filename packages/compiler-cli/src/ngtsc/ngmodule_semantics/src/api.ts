/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import * as ts from 'typescript';

import {absoluteFromSourceFile, AbsoluteFsPath} from '../../file_system';
import {ClassDeclaration} from '../../reflection';

/**
 * Represents a symbol that is recognizable across incremental rebuilds, which enables the captured
 * metadata to be compared to the prior compilation. This allows for semantic understanding of
 * the changes that have been made in a rebuild, which potentially enables more reuse of work
 * from the prior compilation.
 */
export abstract class SemanticSymbol {
  /**
   * The path of the file that declares this symbol.
   */
  public readonly path: AbsoluteFsPath;

  /**
   * The identifier of this symbol, or null if no identifier could be determined. It should
   * uniquely identify the symbol relative to `file`. This is typically just the name of a
   * top-level class declaration, as that uniquely identifies the class within the file.
   *
   * If the identifier is null, then this symbol cannot be recognized across rebuilds. In that
   * case, the symbol is always assumed to have semantically changed to guarantee a proper
   * rebuild.
   */
  public readonly identifier: string|null;

  constructor(
      /**
       * The declaration for this symbol.
       */
      public readonly decl: ClassDeclaration,
  ) {
    this.path = absoluteFromSourceFile(decl.getSourceFile());
    this.identifier = getSymbolIdentifier(decl);
  }

  /**
   * Allows the symbol to be compared to the equivalent symbol in the previous compilation. The
   * return value indicates whether the symbol has been changed in a way such that its public API
   * is affected.
   *
   * This method determines whether a change to _this_ symbol require the symbols that
   * use to this symbol to be re-emitted.
   *
   * Note: `previousSymbol` is obtained from the most recently succeeded compilation. Symbols of
   * failed compilations are never provided.
   *
   * @param previousSymbol The symbol from a prior compilation.
   */
  abstract isPublicApiAffected(previousSymbol: SemanticSymbol): boolean;

  /**
   * Allows the symbol to determine whether its emit is affected. The equivalent symbol from a prior
   * build is given, in addition to the set of symbols of which the public API has changed.
   *
   * This method determines whether a change to _other_ symbols, i.e. those present in
   * `publicApiAffected`, should cause _this_ symbol to be re-emitted.
   *
   * @param previousSymbol The equivalent symbol from a prior compilation. Note that it may be a
   * different type of symbol, if e.g. a Component was changed into a Directive with the same name.
   * @param publicApiAffected The set of symbols which of which the public API has changed.
   */
  isEmitAffected?(previousSymbol: SemanticSymbol, publicApiAffected: Set<SemanticSymbol>): boolean;
}

function getSymbolIdentifier(decl: ClassDeclaration): string|null {
  if (!ts.isSourceFile(decl.parent)) {
    return null;
  }

  if (!hasExportModifier(decl)) {
    // If the declaration is not itself exported, then it is still possible for the declaration
    // to be exported elsewhere, possibly using a different exported name. Therefore, we cannot
    // consider the declaration's own name as its unique identifier.
    //
    // For example, renaming the name by which this declaration is exported without renaming the
    // class declaration itself requires that any references to the declarations must be re-emitted
    // to use its new exported name. The semantic dependency graph would be unaware of this rename
    // however, hence non-exported declarations are excluded from semantic tracking by not assigning
    // them a unique identifier.
    //
    // This relies on the assumption that the reference emitter prefers the direct export of the
    // declaration. This is currently not the case however; the reference emitter chooses the first
    // export in the source file that corresponds with the reference. As such, if a class is itself
    // exported _and_ a secondary export of the class appears above it, renaming that secondary
    // export would not currently trigger re-emit of any symbols that refer to the declaration by
    // its previous name.
    return null;
  }

  // If this is a top-level class declaration, the class name is used as unique identifier.
  // Other scenarios are currently not supported and causes the symbol not to be identified
  // across rebuilds, unless the declaration node has not changed.
  return decl.name.text;
}

function hasExportModifier(decl: ClassDeclaration): boolean {
  return decl.modifiers !== undefined &&
      decl.modifiers.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword);
}
