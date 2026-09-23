// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Changing the alignment of a line directly followed by a block MathJax
 * element used to delete the MathJax (issue #5176): Chromium's justify*
 * commands pull the frame's start handle out of the <anki-frame>, which the
 * frame observer (ts/lib/editable/frame-element.ts) took for the user
 * deleting into the frame, so it removed the whole frame.
 *
 * The tests below cover both sides: alignment must keep the MathJax, and a
 * genuine Delete/Backspace into a frame must still remove it.
 */

import { AddNoteRequest } from "@generated/anki/notes_pb";
import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { decodeRequestBody, editableField, isRpc } from "./helpers";

const TEXT_THEN_BLOCK_MATHJAX = "First line<anki-mathjax block=\"true\">x^2</anki-mathjax>";
const TEXT_THEN_INLINE_MATHJAX = "First line<anki-mathjax>x^2</anki-mathjax> tail";

async function setFieldHtml(page: Page, html: string): Promise<Locator> {
    const field = editableField(page, 0);
    await expect(field).toBeAttached({ timeout: 10_000 });
    await field.click();
    await field.evaluate((el: HTMLElement, html: string) => {
        el.innerHTML = html;
    }, html);
    // The MathJax element is decorated (wrapped in a frame) once connected.
    await expect(field.locator("anki-frame > frame-start + anki-mathjax + frame-end")).toBeAttached({
        timeout: 5_000,
    });
    return field;
}

/**
 * Collapse the selection at `offset` inside the first child text node of
 * `selector` (or of the field itself when null). Selections inside the
 * field's shadow root have to be set from within the page.
 */
async function placeCaret(field: Locator, selector: string | null, offset: number): Promise<void> {
    await field.evaluate(
        (el: HTMLElement, { selector, offset }: { selector: string | null; offset: number }) => {
            const container = selector ? el.querySelector(selector)! : el;
            const range = document.createRange();
            range.setStart(container.firstChild!, offset);
            range.collapse(true);
            const root = el.getRootNode() as Document | ShadowRoot;
            const selection = (root as Document).getSelection?.() ?? document.getSelection()!;
            selection.removeAllRanges();
            selection.addRange(range);
        },
        { selector, offset },
    );
}

async function expectIntactFrame(field: Locator): Promise<void> {
    await expect(field.locator("anki-frame > frame-start + anki-mathjax + frame-end")).toBeAttached();
    expect(await field.locator("anki-mathjax").count()).toBe(1);
}

test("centering the line before a block MathJax keeps the MathJax", async ({ editor: page }) => {
    const field = await setFieldHtml(page, TEXT_THEN_BLOCK_MATHJAX);
    // caret at the end of the text, directly before the MathJax
    await placeCaret(field, null, "First line".length);

    await page.getByTitle("Alignment").click();
    await page.getByTitle("Center").click();

    await expectIntactFrame(field);
    expect(await field.evaluate((el: HTMLElement) => el.innerHTML)).toContain(
        "<div style=\"text-align: center;\">First line</div>",
    );

    // The saved note must contain both the alignment and the MathJax.
    const addNoteRequest = page.waitForRequest(isRpc("addNote"), { timeout: 10_000 });
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.waitForResponse(
        (resp) => isRpc("addNote")(resp.request()) && resp.status() < 400,
        { timeout: 10_000 },
    );
    const decoded = decodeRequestBody(await addNoteRequest, AddNoteRequest);
    expect(decoded.note?.fields[0]).toContain("text-align: center");
    expect(decoded.note?.fields[0]).toContain("\\[x^2\\]");
});

for (const command of ["justifyLeft", "justifyRight", "justifyFull"]) {
    test(`${command} with the caret inside the line before a block MathJax keeps the MathJax`, async ({ editor: page }) => {
        const field = await setFieldHtml(page, TEXT_THEN_BLOCK_MATHJAX);
        await placeCaret(field, null, 5);

        await page.evaluate((command: string) => document.execCommand(command), command);

        await expectIntactFrame(field);
        await expect(field).toContainText("First line");
    });
}

test("deleting forwards into a block MathJax still removes it", async ({ editor: page }) => {
    const field = await setFieldHtml(page, TEXT_THEN_BLOCK_MATHJAX);
    await placeCaret(field, "frame-start", 0);

    await page.keyboard.press("Delete");

    await expect(field.locator("anki-mathjax")).toHaveCount(0);
    await expect(field.locator("anki-frame")).toHaveCount(0);
    await expect(field).toHaveText("First line");
});

test("deleting backwards into an inline MathJax still removes it", async ({ editor: page }) => {
    const field = await setFieldHtml(page, TEXT_THEN_INLINE_MATHJAX);
    await placeCaret(field, "frame-end", 1);

    await page.keyboard.press("Backspace");

    await expect(field.locator("anki-mathjax")).toHaveCount(0);
    await expect(field.locator("anki-frame")).toHaveCount(0);
    await expect(field).toContainText("First line");
    await expect(field).toContainText("tail");
});
