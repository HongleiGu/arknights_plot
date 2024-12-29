package com.arknights;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;

public class InitialisingSQL {
  public static void insertComment(String story, String chapter, String dialog, String speaker, String dialogType) {
    String url = "jdbc:mysql://localhost:3306/plots";
    String user = "root";
    String password = "123456";

    String sql = "INSERT INTO comments (story, chapter, dialog, speaker, dialog_type) VALUES (?, ?, ?)";

    try {
        Connection connection = DriverManager.getConnection(url, user, password);
        Class.forName("com.mysql.jdbc.Driver");
        PreparedStatement preparedStatement = connection.prepareStatement(sql);
        preparedStatement.setString(1, story);
        preparedStatement.setString(2, chapter);
        preparedStatement.setString(3, dialog);
        preparedStatement.setString(4, speaker);
        preparedStatement.setString(5, dialogType);


        preparedStatement.executeUpdate();  // Execute the insertion
        System.out.println("Comment inserted successfully");

    } catch (Exception e) {
        System.out.println("Insertion failed: " + e.getMessage());
    }
  }

  public static void main(String[] args) {
    insertComment("some story", "some chapter", "some dialog", "some speaker", "some type");
  }
}
