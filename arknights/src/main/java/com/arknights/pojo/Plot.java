package com.arknights.pojo;

import java.time.LocalDateTime;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.ToString;

@Data
@ToString
@AllArgsConstructor
@NoArgsConstructor
public class Plot {
  public Integer dialogId;
  public String story;
  public String chapter;
  public String dialog;
  public String speaker;
  public String dialogType;
  public String storyType;
  public LocalDateTime createdAt;
  public LocalDateTime alteredAt;

  public Plot (String story, String chapter) {
    this.story = story;
    this.chapter = chapter;
    this.dialog = "";
    this.dialogType = "";
    this.storyType = "";
  }
}
