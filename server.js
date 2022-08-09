import fastify from 'fastify';
import sensible from '@fastify/sensible';
import dotenv from 'dotenv';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { PrismaClient } from '@prisma/client';
dotenv.config();

const app = fastify();
app.register(sensible);
app.register(cookie, { secret: process.env.COOKIE_SECRET });
app.register(cors, {
  origin: process.env.CLIENT_URL,
  credentials: true,
});

app.addHook('onRequest', (req, res, done) => {
  if (req.cookies.userId !== CURRENT_USER_ID) {
    req.cookies.userId = CURRENT_USER_ID;
    res.clearCookie('userId');
    res.setCookie('userId', CURRENT_USER_ID);
  }
  done();
});

const prisma = new PrismaClient();

const CURRENT_USER_ID = (await prisma.user.findFirst({ where: { name: 'John' } })).id;

const COMMENT_SELECT_FIELDS = {
  id: true,
  message: true,
  parentId: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      name: true,
    },
  },
};

app.get('/posts', async (req, res) => {
  return await commitToDb(
    prisma.post.findMany({
      select: {
        id: true,
        title: true,
      },
    })
  );
});

app.get('/posts/:id', async (req, res) => {
  return await commitToDb(
    prisma.post
      .findUnique({
        where: {
          id: req.params.id,
        },
        select: {
          body: true,
          title: true,
          comments: {
            orderBy: {
              createdAt: 'desc',
            },
            select: {
              ...COMMENT_SELECT_FIELDS,
              _count: { select: { likes: true } },
            },
          },
        },
      })
      .then(async (post) => {
        const likes = await prisma.like.findMany({
          where: {
            userId: req.cookies.userId,
            commentId: { in: post.comments.map((comment) => comment.id) },
          },
        });

        return {
          ...post,
          comments: post.comments.map((comment) => {
            const { _count, ...commentFields } = comment;
            return {
              ...commentFields,
              likedByMe: likes.find((like) => like.commentId === comment.id),
              likeCount: _count.likes,
            };
          }),
        };
      })
  );
});

app.post('/posts/:id/comments', async (req, res) => {
  const message = req.body?.message;
  const parentId = req.body?.parentId;

  if (message === '' || message === null) {
    return res.send(app.httpErrors.badRequest('Message is required'));
  }

  return await commitToDb(
    prisma.comment
      .create({
        data: { message, userId: req.cookies.userId, parentId, postId: req.params.id },
        select: COMMENT_SELECT_FIELDS,
      })
      .then((comment) => {
        return {
          ...comment,
          likeCount: 0,
          likedByMe: false,
        };
      })
  );
});

app.put('/posts/:postId/comments/:commentId', async (req, res) => {
  const message = req.body?.message;

  if (message === '' || message === null) {
    return res.send(app.httpErrors.badRequest('Message is required'));
  }

  const { userId } = await prisma.comment.findUnique({
    where: { id: req.params.commentId },
    select: { userId: true },
  });

  if (userId !== req.cookies.userId) {
    return res.send(app.httpErrors.unauthorized('You do not have permission to edit this message'));
  }

  return await commitToDb(
    prisma.comment
      .update({
        where: { id: req.params.commentId },
        data: { message },
        select: { message: true },
      })
      .then((comment) => {
        return {
          ...comment,
          likeCount: 0,
          likedByMe: false,
        };
      })
  );
});

app.delete('/posts/:postId/comments/:commentId', async (req, res) => {
  const { userId } = await prisma.comment.findUnique({
    where: { id: req.params.commentId },
    select: { userId: true },
  });

  if (userId !== req.cookies.userId) {
    return res.send(app.httpErrors.unauthorized('You do not have permission to edit this message'));
  }

  return await commitToDb(
    prisma.comment.delete({
      where: { id: req.params.commentId },
      select: { id: true },
    })
  );
});

async function commitToDb(promise) {
  const [error, data] = await app.to(promise);

  if (error) return app.httpErrors.internalServerError(error.message);

  return data;
}

app.listen({ port: process.env.PORT });
