/** A mode-agnostic handle on the scene editor, so the AI panel works the same
 *  whether the user is in rich-text or markdown mode. */
export interface EditorBridge {
  /** Plain text of the current selection (empty string if none). */
  getSelectionText(): string;
  /** Capture the current selection as an opaque range for a later replace. */
  captureSelection(): unknown;
  /** Replace a previously captured range with AI text (markdown/plain prose). */
  replaceRange(range: unknown, text: string): Promise<void>;
  /** Append AI text to the end of the scene. */
  appendToEnd(text: string): Promise<void>;
  /** The paragraph under the cursor (used by actions when nothing is selected). */
  captureBlock(): { text: string; range: unknown } | null;
}
