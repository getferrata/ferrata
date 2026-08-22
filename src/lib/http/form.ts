/**
 * A text field out of a multipart form, or "" when it is not text.
 *
 * `FormData.get` returns a string, a File, or null. Stringifying the File case
 * gives the literal "[object File]", so a request that sends a file part under
 * a field the server reads as text does not fail: it succeeds with that string
 * as the value. A course brief of "[object File]" is the kind of thing that is
 * found later, in the generated course.
 */
export function formString(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}
