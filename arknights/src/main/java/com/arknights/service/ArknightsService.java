package com.arknights.service;

import org.springframework.stereotype.Service;

import com.arknights.pojo.Choice;
import com.arknights.pojo.Comment;
import com.arknights.pojo.Image;
import com.arknights.pojo.Outcome;
import com.arknights.pojo.Plot;
import com.github.pagehelper.PageInfo;

import java.util.List;

@Service
public interface ArknightsService {

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

  public PageInfo<Plot> listPlots(
    String story,
    String chapter,
    Integer pageNum, 
    Integer pageSize
  );

  public PageInfo<Comment> listComments(
    String story,
    String chapter,
    String username,
    Integer pageNum, 
    Integer pageSize
  );

  public PageInfo<Comment> listAllComments(
    Integer pageNum, 
    Integer pageSize
  );

  public void editComments(
    Integer commentId,
    String commentContent
  );

  public void deleteComments(
    Integer commentId
  );

  public PageInfo<Outcome> listOutcomes(
    Integer decisionValue, 
    Integer decisionId, 
    String story, 
    String chapter,
    Integer pageNum, 
    Integer pageSize
  );

  public PageInfo<Choice> listChoices(
    Integer decisionId, 
    String story, 
    String chapter,
    Integer pageNum, 
    Integer pageSize
  );

  // public List<Image> listImages(
  //   String storyName
  // );
}
