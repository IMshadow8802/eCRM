import { LOGIN_ERRORS, UNREACHABLE, loginError } from "./authMessages";

const reply = (data: unknown) => ({ response: { data } });

it("a known code reads in E's words, whatever the server said", () => {
  // The server's code rides along, so the form can key on it (E 03 rings the password).
  expect(loginError(reply({ code: "INVALID_CREDENTIALS", message: "Incorrect username or password" }))).toEqual({
    ...LOGIN_ERRORS.INVALID_CREDENTIALS,
    code: "INVALID_CREDENTIALS",
  });
});

it("any other code keeps the server's text", () => {
  expect(loginError(reply({ code: "USER_INACTIVE", message: "Inactive" }))).toEqual({ title: "Inactive", code: "USER_INACTIVE" });
  expect(loginError(reply({ message: "No code" }))).toEqual({ title: "No code" });
});

it("no reply, or a reply that explains nothing, is the connection fallback", () => {
  expect(loginError(new Error("Network Error"))).toBe(UNREACHABLE);
  expect(loginError(null)).toBe(UNREACHABLE);
  expect(loginError(reply({ code: "WHATEVER" }))).toBe(UNREACHABLE);
});
