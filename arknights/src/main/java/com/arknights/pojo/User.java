package com.arknights.pojo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.ToString;

@Data
@ToString
@NoArgsConstructor
@AllArgsConstructor
public class User {
  private Integer id;
  private String username;
  private String password;

  public User(String username, String password) {
    this.id = null;
    this.username = username;
    this.password = password;
  }
}
