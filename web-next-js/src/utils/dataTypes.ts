// import {z} from "zod"

// export const Plot = z.object({
//   dialogId: z.number(),
//   story: z.string(),
//   chapter: z.string(),
//   dialog: z.string(),
//   speaker: z.string(),
//   dialogType: z.string(),
//   storyType: z.string(),
//   createdAt: z.string().datetime(),
//   alteredAt: z.string().datetime()
// });

// export const Choice = z.object({
//   choiceId: z.number(),
//   decisionId: z.number(),
//   decision: z.string(),
//   story: z.string(),
//   chapter: z.string(),
//   decisionValue: z.number(),
//   storyType: z.string()
// })

// export const Outcome = z.object({
//   outcomeId: z.number(),
//   decisionId: z.number(),
//   dialog: z.string(),
//   speaker: z.string(),
//   dialogType: z.string(),
//   story: z.string(),
//   chapter: z.string(),
//   decisionValue: z.number(),
//   storyType: z.string()
// })

// export const Comment = z.object({
//   commentId: z.number(),
//   decisionId: z.number(),
//   outcomeId: z.number(),
//   story: z.string(),
//   chapter: z.string(),
//   username: z.string(),
//   commentContent: z.string(),
//   storyType: z.string()
// })

// export const Image = z.object({
//   id: z.number(),
//   name: z.string(),
//   icon: z.string(),
//   cover: z.string(),
//   name_en: z.string(),
//   info: z.string(),
//   type: z.string(),
//   shift: z.number()
// })

// Interface for Plot
export interface Plot {
  dialogId: number;
  story: string;
  chapter: string;
  dialog: string;
  speaker: string;
  dialogType: string;
  storyType: string;
  createdAt?: string; // ISO string date
  alteredAt?: string; // ISO string date
}

// Interface for Choice
export interface Choice {
  choiceId: number;
  decisionId: number;
  decision: string;
  story: string;
  chapter: string;
  decisionValue: number;
  storyType: string;
}

// Interface for Outcome
export interface Outcome {
  outcomeId: number;
  decisionId: number;
  dialog: string;
  speaker: string;
  dialogType: string;
  story: string;
  chapter: string;
  decisionValue: number;
  storyType: string;
}

// Interface for Comment
export interface Comment {
  dialogId?: number,
  commentId: number,
  // decisionId: number,
  outcomeId?: number,
  choiceId?: number,
  story: string,
  chapter: string,
  username: string,
  commentContent: string,
  storyType: string,
}

// Interface for Image
export interface Images {
  id: number;
  name: string;
  icon: string;
  cover: string;
  name_en: string;
  info: string;
  type: string;
  shift: number;
}

// export interface User {
//   id?: number,
//   username: string,
//   password: string
// }

export interface UserQuery {
  id: number,
  username: string
  password: string
}



export const emptyImage: Images = {
  id: -1,              // Placeholder value
  name: '',            // Empty string for the name
  icon: '',            // Empty string for the icon
  cover: '',           // Empty string for the cover URL
  name_en: '',         // Empty string for the English name
  info: '',            // Empty string for additional info
  type: '',            // Empty string for the type
  shift: 0,            // Placeholder value for shift
};