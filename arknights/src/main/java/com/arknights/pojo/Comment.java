package com.arknights.pojo;

import lombok.Data;
import lombok.ToString;

@Data
@ToString
public class Comment {
  public Integer commentId;
  public Integer dialogId;
  public Integer decisionId;
  public Integer outcomeId;
  public String story;
  public String chapter;
  public String username;
  public String commentContent;
  public String storyType;
}
