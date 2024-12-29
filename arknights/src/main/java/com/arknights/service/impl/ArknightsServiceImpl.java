package com.arknights.service.impl;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.arknights.mapper.ArknightsMapper;
import com.arknights.pojo.Choice;
import com.arknights.pojo.Comment;
import com.arknights.pojo.Image;
import com.arknights.pojo.Outcome;
import com.arknights.pojo.Plot;
import com.arknights.service.ArknightsService;

import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;

@Service
public class ArknightsServiceImpl implements ArknightsService{
  @Autowired
  private ArknightsMapper mapper;

  /** 
   * 插入剧情,用于初始化数据库  
   */
  @Override
  public void insertPlot(Plot plot) {
    mapper.insertPlot(plot);
  }

  @Override
  public void insertChoices(Choice choice) {
    mapper.insertChoices(choice);
  }

  @Override
  public void insertOutcomes(Outcome outcome) {
    mapper.insertOutcomes(outcome);
  }

  @Override
  public void insertComments(Comment comment) {
    mapper.insertComments(comment);
  }

  @Override
  public PageInfo<Plot> listPlots(String story, String chapter, Integer pageNum, Integer pageSize) {
    PageHelper.startPage(pageNum, pageSize);
    return new PageInfo<Plot>(mapper.listPlots(story, chapter));
  }

  @Override
  public PageInfo<Comment> listComments(String story, String chapter, String username, Integer pageNum, Integer pageSize) {
    PageHelper.startPage(pageNum, pageSize);
    return new PageInfo<Comment>(mapper.listComments(story, chapter, username));
  }


  @Override
  public PageInfo<Comment> listAllComments(Integer pageNum, Integer pageSize) {
    PageHelper.startPage(pageNum, pageSize);
    return new PageInfo<Comment>(mapper.listAllComments());
  }

  @Override
  public void editComments(Integer commentId, String commentContent) {
    mapper.editComments(commentId, commentContent);
  }

  @Override
  public void deleteComments(Integer commentId) {
    mapper.deleteComments(commentId);
  }

  @Override
  public PageInfo<Outcome> listOutcomes(Integer decisionValue, Integer decisionId, String story, String chapter, Integer pageNum, Integer pageSize) {
    PageHelper.startPage(pageNum, pageSize);
    return new PageInfo<Outcome>(mapper.listOutcomes(decisionValue, decisionId, story, chapter));
  }

  @Override
  public PageInfo<Choice> listChoices(Integer decisionId, String story, String chapter, Integer pageNum, Integer pageSize) {
    PageHelper.startPage(pageNum, pageSize);
    return new PageInfo<Choice>(mapper.listChoices(decisionId, story, chapter));
  }

  // @Override
  // public List<Image> listImages(String storyName) {
  //   return mapper.listImages(storyName);
  // } 
}
