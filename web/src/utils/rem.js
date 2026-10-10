// A design px value (drawn against the 15px root) as rem, so it scales with
// the fluid root font size in index.css. For values computed in JS; literal
// sizes in sx/style are written "calc(Nrem / 15)" directly.
export const rem = (px) => `${px / 15}rem`;
