import { pagination } from "./fixtures";

it("pagination derives totalPages from the default page size", () => {
  expect(pagination(120)).toMatchObject({ pageSize: 50, totalPages: 3 });
  expect(pagination(0).totalPages).toBe(1);
});

it("pagination derives totalPages from a given page size", () => {
  expect(pagination(45, { pageSize: 20 })).toMatchObject({ pageSize: 20, totalPages: 3 });
});
