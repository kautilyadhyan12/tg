import { describe, expect, it } from "vitest";
import { barcodeCheckDigitOk, classifyBarcode, upcEToUpcA } from "../src/barcode.js";

describe("the worst thing: a barcode that is not one product worldwide is never looked up", () => {
  // Real rows of Open Food Facts' file, 2026-10-30: one number, whichever store printed it.
  it.each([
    ["00000758", "a Sainsbury's cauliflower"],
    ["00002523", "a Sainsbury's peach"],
    ["00001816", "a Trader Joe's bread"],
    ["20000165", "a Lidl brand's prunes"],
    ["0200024010652", "a French store's nougat, by weight"],
    ["200024010652", "the same, as 12 digits"],
  ])("%s, %s, is the store's own", (code) => {
    expect(classifyBarcode(code)).toEqual({ kind: "store_only" });
  });

  it("a misread digit is refused, however real the product it lands on", () => {
    // 12345678 fails its check digit, and Open Food Facts answers it with a junk product, "Ror".
    expect(classifyBarcode("12345678")).toEqual({ kind: "bad" });
    expect(classifyBarcode("3017620422004")).toEqual({ kind: "bad" }); // Nutella, last digit wrong
    expect(classifyBarcode("3017620422013")).toEqual({ kind: "bad" }); // one digit misread
  });
});

describe("classifyBarcode", () => {
  it.each([
    ["3017620422003", "3017620422003", "Nutella, EAN-13"],
    ["8901262010016", "8901262010016", "Amul butter, India's prefix"],
    ["049000006346", "0049000006346", "US Coca-Cola as printed: UPC-A, 12 digits"],
    ["0049000006346", "0049000006346", "the same in 13 digits"],
    ["00049000006346", "0049000006346", "the same in 14"],
    ["42104964", "42104964", "an EAN-8 from a company's own prefix"],
  ])("%s reads as %s (%s)", (raw, code) => {
    expect(classifyBarcode(raw)).toEqual({ kind: "product", code });
  });

  it.each(["9780141026626", "9791034919277", "9771234567003"])("%s, a book or a magazine, is not a food", (code) => {
    expect(barcodeCheckDigitOk(code)).toBe(true);
    expect(classifyBarcode(code)).toEqual({ kind: "not_a_food" });
  });

  it.each(["", "abc", "1234567", "123456789", "30176204220031", "301762042200", "3017620422003 ", "٣٠١٧٦٢٠٤٢٢٠٠٣"])("%j is no barcode", (raw) => {
    expect(classifyBarcode(raw)).toEqual({ kind: "bad" });
  });
});

describe("upcEToUpcA, the short code on small packs", () => {
  // 04252614 is the worked example on Wikipedia's "Universal Product Code" page. The rest are one for
  // each row of GS1's table for the last digit, their check digits worked out by hand from the long form.
  it.each([
    ["04252614", "042100005264", "last digit 1, published"],
    ["01234505", "012000003455", "last digit 0"],
    ["01234514", "012100003454", "last digit 1"],
    ["01234523", "012200003453", "last digit 2"],
    ["01234531", "012300000451", "last digit 3"],
    ["01234543", "012340000053", "last digit 4"],
    ["01234558", "012345000058", "last digit 5"],
  ])("%s is %s (%s)", (upcE, upcA) => {
    expect(upcEToUpcA(upcE)).toBe(upcA);
    expect(barcodeCheckDigitOk(upcA)).toBe(true);
  });

  it("refuses a code with a wrong check digit or the wrong shape", () => {
    expect(upcEToUpcA("04252615")).toBeNull();
    expect(upcEToUpcA("94252614")).toBeNull();
    expect(upcEToUpcA("425261")).toBeNull();
  });
});
