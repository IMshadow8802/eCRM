// src/utils/actor.js
//
// The person acting, taken from the verified session (req.user, set by verifyToken)
// and never from the request body/query/params. Leads, complaints, follow-ups and
// quotations pass this to every procedure; tests/unit/controllers/actorContract.test.js
// keeps it that way.
function actor(req) {
  const CompId = Number(req?.user?.CompId);
  const UserId = Number(req?.user?.UserId);
  if (!CompId || !UserId) throw new Error("NO_ACTOR");
  return { CompId, UserId };
}

module.exports = { actor };
