declare module 'pdf-parse' {
  type PdfData = { text: string; numpages: number };
  function pdfParse(data: Buffer): Promise<PdfData>;
  export default pdfParse;
}
