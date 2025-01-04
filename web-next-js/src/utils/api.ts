'use server';
// import { getSession } from "next-auth/react";
// import { NextApiRequest, NextApiResponse } from 'next';


// import { z } from 'zod';
import { sql } from '@vercel/postgres';
import { Choice, Comment, Images, Outcome, Plot, UserQuery} from './dataTypes';
import { User } from 'next-auth';
import { convertKeysToCamelCase } from '.';
// import { Plot, Choice, Comment, Outcome, Image } from './dataTypes';
 
// export async function listPlots(plot: FormData) {
//   const {story, chapter} = Plot.omit({
//     dialogId: true,
//     dialog: true,
//     speaker: true,
//     dialogType: true,
//     storyType: true,
//     createdAt: true,
//     alteredAt: true
//   }).parse({
//     story: plot.get("story"),
//     chapter: plot.get("chapter")
//   })
export async function listPlots(
  story: string,
  chapter: string,
  pageSize: number,
  pageNum: number
): Promise<Plot[]> {
  const offset = (pageNum - 1) * pageSize; // Calculate the offset
  // console.log(`
  //   SELECT * FROM plots 
  //   WHERE story = ${story} 
  //     AND chapter = ${chapter} 
  //   LIMIT ${pageSize} OFFSET ${offset};
  // `);
  const result = await sql`
    SELECT * FROM plots 
    WHERE story = ${story} 
      AND chapter = ${chapter} 
    LIMIT ${pageSize} OFFSET ${offset};
  `;
  // console.log(result.rows[0])
  // console.log(result.rows.map(it => convertKeysToCamelCase(it) as Plot))
  return result.rows.map(it => convertKeysToCamelCase(it) as Plot);
}

export async function getPlotCount(story: string, chapter: string): Promise<number> {
  const result = await sql`
    SELECT * FROM plots 
    WHERE story = ${story} 
    AND chapter = ${chapter} 
  `;

  // The result is an array, and we access the count from the first row
  return result.rowCount!;
}

// export async function listComments(comment: FormData) {
//   const {story, chapter, username} = Comment.omit({
//     commentId: true,
//     decisionId: true,
//     outcomeId: true,
//     // story: z.string(),
//     // chapter: z.string(),
//     // username: z.string(),
//     commentContent: true,
//     storyType: true
//   }).parse({
//     story: comment.get("story"),
//     chapter: comment.get("chapter"),
//     username: comment.get("username")
//   })
export async function listComments(
  story: string,
  chapter: string,
  username: string,
  pageSize: number,
  pageNum: number
): Promise<Comment[]> {
  const offset = (pageNum - 1) * pageSize; // Calculate the offset based on pageNum and pageSize
  const result = await sql`
    SELECT * FROM comments 
    WHERE story = ${story} 
      AND chapter = ${chapter} 
      AND username = ${username} 
    LIMIT ${pageSize} OFFSET ${offset};
  `;
  // console.log(`
  //   SELECT * FROM comments 
  //   WHERE story = ${story} 
  //     AND chapter = ${chapter} 
  //     AND username = ${username} 
  //   LIMIT ${pageSize} OFFSET ${offset};
  // `)
  // console.log(result.rows)
  return result.rows.map(it => convertKeysToCamelCase(it) as Comment);
}

export async function getCommentCount(story: string, chapter: string): Promise<number> {
  const result = await sql`
    SELECT * FROM comments
    WHERE story = ${story} 
    AND chapter = ${chapter} 
  `;

  // The result is an array, and we access the count from the first row
  return result.rowCount!;
}

export async function editComments(commentId: number, commentContent: string): Promise<void> {
  if (commentContent == null) {
    commentContent = ""
  }
  await sql`
    UPDATE comments SET comment_content = ${commentContent} WHERE comment_id = ${commentId}
  `;
}

export async function deleteComments(commentId: number) {
  await sql`
    DELETE FROM comments WHERE comment_id = ${commentId}
  `
}

export async function addComments(comment: Comment) {
  if (comment.dialogId != null) {
    // 如果dialogId不为空,说明这是对对话正文的批注
    await sql`
      INSERT INTO comments (dialog_id, story, chapter, username, comment_content, story_type)
      VALUES(${comment.dialogId}, ${comment.story}, ${comment.chapter}, ${comment.username}, ${comment.commentContent}, ${comment.storyType})
    `
  } else if (comment.choiceId != null && comment.outcomeId != null) {
    // 如果choiceId和commentId不为空,说明这是对outcome的批注
    await sql`
      INSERT INTO comments (outcome_id, choice_id, story, chapter, username, comment_content, story_type)
      VALUES(${comment.outcomeId}, ${comment.choiceId}, ${comment.story}, ${comment.chapter}, ${comment.username}, ${comment.commentContent}, ${comment.storyType});
    `
  } else if (comment.choiceId != null) {
    // 如果choiceId不为空但outcomeId为空,说明这是对选择本身的批注
    await sql`
      INSERT INTO comments (choice_id, story, chapter, username, comment_content, story_type)
      VALUES(${comment.choiceId}, ${comment.story}, ${comment.chapter}, ${comment.username}, ${comment.commentContent}, ${comment.storyType});
    `
  }
}

 
// export async function listChoices(choice: FormData) {
//   const {decisionId, story, chapter} = Choice.omit({
//     choiceId: true,
//     decision: true,
//     decisionValue: true,
//     storyType: true
//   }).parse({
//     decisionId: choice.get("decision"),
//     story: choice.get("story"),
//     chapter: choice.get("chapter")
//   })
export async function listChoices(decisionId: number, story: string, chapter: string) {
  const result = await sql`
    SELECT * FROM choices WHERE decision_id = ${decisionId} AND chapter = ${chapter} AND story = ${story}
  `;
  return result.rows.map(it => convertKeysToCamelCase(it) as Choice)
}

 
// export async function listOutcomes(outcome: FormData) {
//   const {decisionId, story, chapter, decisionValue} = Outcome.omit({
//     outcomeId: true,
//     dialog: true,
//     speaker: true,
//     dialogType: true,
//     storyType: true
//   }).parse({
//     decisionId: outcome.get("decisionId"), 
//     story: outcome.get("story"),
//     chapter: outcome.get("chapter"),
//     decisionValue: outcome.get("decisionValue")
//   })
export async function listOutcomes(decisionId: number, story: string, chapter: string, decisionValue: number): Promise<Outcome[]> {
  const result = await sql`
    SELECT * FROM outcomes WHERE decision_id = ${decisionId} AND chapter = ${chapter} AND story = ${story} AND decision_value = ${decisionValue}
  `;
  return result.rows.map(it => convertKeysToCamelCase(it) as Outcome);
}

// export async function listImagesByType(image: FormData) {
//   const {} = Image.omit({
//     id: z.number(),
//     name: z.string(),
//     icon: z.string(),
//     cover: z.string(),
//     name_en: z.string(),
//     info: z.string(),
//     type: z.string(),
//     shift: z.number()
//   })
export async function listImages(type: null | string, storyName: null | string): Promise<Images[]> {
  let result;
  if (storyName != null) {
    result = await sql`SELECT * FROM images WHERE name = ${storyName}`
  }
  else if (type != null) {
    result = await sql`SELECT * FROM images WHERE type = ${type}`
  } else {
    throw new Error("either type or storyName needs to be provided");
  }
  return result.rows.map(it => convertKeysToCamelCase(it) as Images)
}

export async function listStory(type: string, chapter: string) {
  // console.log(type, chapter, `SELECT story FROM stories WHERE chapter = ${chapter} AND story_type = ${type} ORDER BY story_id`)
  const result = await sql`SELECT story FROM stories WHERE chapter = ${chapter} AND story_type = ${type} ORDER BY story_id`
  return result.rows.map(it => convertKeysToCamelCase(it).story as unknown as string)
}

export async function login(username: string, password: string): Promise<User[]> {
  const result = await sql`SELECT * FROM users WHERE username = ${username} AND password = ${password}`;
  return result.rows.map(it => convertKeysToCamelCase(it) as User)
}


// we assume that every call to register have pre-checked params
export async function register(user: {username: string, password: string}): Promise<void> {
  const { username, password } = user;

  // try {
  // const result = 
  await sql`INSERT INTO users (username, password) VALUES (${username}, ${password})`;
  // return result.rows[0].id; // Return the inserted user ID 
  // } catch {
  //   return null;
  // }
}

export async function findUsername(username: string): Promise<UserQuery[]> {
  const result = await sql`SELECT * FROM users WHERE username = ${username}`;
  return result.rows.map(it => convertKeysToCamelCase(it) as UserQuery)
  // return result.rows.map(it => convertKeysToCamelCase(it) as User) // Return the count as a number
}

export async function getCommentTag(commentId: number): Promise<string[] | null> {
  try {
    const result = await sql`SELECT * FROM commentTag WHERE comment_id = ${commentId}`;
    // Check if any rows were returned
    if (result.rows.length > 0) {
      // Assuming the desired column is 'tag', adjust as necessary
      return result.rows.map(it => it.tag as string); 
    }
    return null; // Return null if no tag is found
  } catch (error) {
    console.error('Error fetching comment tag:', error);
    throw new Error('Failed to fetch comment tag');
  }
}

export async function addCommentTag(tag: string, commentId: number): Promise<void> {
  // console.log(`INSERT INTO commentTag (comment_id, tag) VALUES (${commentId}, ${tag})`);
  await sql`INSERT INTO commenttag (comment_id, tag) VALUES (${commentId}, ${tag})`;
}