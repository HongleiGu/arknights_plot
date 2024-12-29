package com.arknights.pojo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.ToString;

@Data
@AllArgsConstructor
@NoArgsConstructor
@ToString
public class Outcome {
  Integer outcomeId;
  Integer decisionId;
  String dialog;
  String speaker;
  String dialogType;
  String story;
  String chapter;
  Integer decisionValue;
  String storyType;
}
