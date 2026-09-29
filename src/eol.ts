// A textarea always yields LF. Edit CRLF files as LF and restore CRLF on save so a small edit
// does not rewrite every line ending in the file.
export const usesCrlf = (text: string) => text.includes('\r\n');
export const toEditable = (text: string) => usesCrlf(text) ? text.replace(/\r\n/g, '\n') : text;
export const fromEditable = (text: string, crlf: boolean) => crlf ? text.replace(/\r?\n/g, '\r\n') : text;
