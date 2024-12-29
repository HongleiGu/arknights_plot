package com.arknights.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;

import com.arknights.pojo.Choice;
import com.arknights.pojo.Comment;
import com.arknights.pojo.Image;
import com.arknights.pojo.Outcome;
import com.arknights.pojo.Plot;

@Mapper
public interface ArknightsMapper {

  /** 
   * 插入剧情,用于初始化数据库  
   */
  public void insertPlot(
    Plot plot
  );

  /** 
   * 插入选择,用于初始化数据库  
   */
  public void insertChoices(
    Choice choice
  );

  /** 
   * 插入选择,用于初始化数据库  
   */
  public void insertOutcomes(
    Outcome outcome
  );

  /** 
   * 插入选择,用于初始化数据库  
   */
  public void insertComments(
    Comment comment
  );

  public List<Plot> listPlots(
    String story,
    String chapter
  );

  public List<Comment> listComments(
    String story,
    String chapter,
    String username
  );

  public List<Comment> listAllComments();

  public void editComments(
    Integer commentId,
    String commentContent
  );

  public void deleteComments(
    Integer commentId
  );

  public List<Outcome> listOutcomes(
    Integer decisionValue, 
    Integer decisionId, 
    String story, 
    String chapter
  );

  public List<Choice> listChoices(
    Integer decisionId, 
    String story, 
    String chapter
  );

  public List<Image> listImages(
    String storyName,
    String type
  );
}
