package com.arknights.pojo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.ToString;

@Data
@AllArgsConstructor
@NoArgsConstructor
@ToString
public class Choice {
  Integer choiceId;
  Integer decisionId;
  String decision;
  String story;
  String chapter;
  Integer decisionValue;
  String storyType;
}
