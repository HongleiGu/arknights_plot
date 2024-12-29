package com.arknights.controller;

import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;

import com.arknights.pojo.Choice;
import com.arknights.pojo.Comment;
import com.arknights.pojo.Image;
import com.arknights.pojo.Outcome;
import com.arknights.pojo.Plot;
import com.arknights.pojo.Result;
import com.arknights.service.ArknightsService;

import lombok.extern.slf4j.Slf4j;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;



@CrossOrigin
@Slf4j
@RestController
public class ArknightsController {
  @Autowired
  private ArknightsService service;

  @PostMapping("/insertPlots")
  public Result insertPlot(@RequestBody Plot plot) {
    service.insertPlot(plot);
    return Result.success();
  }

  @PostMapping("/insertChoices")
  public Result insertChoices(@RequestBody Choice choice) {
    service.insertChoices(choice);
    return Result.success();
  }

  @PostMapping("/insertComments")
  public Result insertComments(@RequestBody Comment comment) {
    service.insertComments(comment);
    return Result.success();
  }

  @PostMapping("/insertOutcomes")
  public Result insertOutcomes(@RequestBody Outcome outcome) {
    log.info("insertOutcomes\n");
    service.insertOutcomes(outcome);
    return Result.success();
  }

  @GetMapping("/listFiles")
  public Result listFilesAndFolders(String filepath) throws IOException {
    Path path = Paths.get("./plot");
    filepath = filepath.replaceFirst("^\\\\", ""); // Remove leading backslash
    filepath = filepath.replaceFirst("^[/]+", ""); // Remove leading forward slashes

    path = path.resolve(filepath);
    Map<String, String> files = new HashMap<String, String>();
    if (Files.exists(path) && Files.isDirectory(path)) {
      try (DirectoryStream<Path> stream = Files.newDirectoryStream(path)) {
        for (Path entry : stream) {
          if (Files.isDirectory(entry)) {
            files.put(entry.getFileName().toString(), "folder");
          } else {
            files.put(entry.getFileName().toString(), "file");
          }
        }
      }
      log.info(files.toString());
      return Result.success(files);
    } else {
      return Result.error("Path does not exist or is not a directory.");
    }
  }

  @GetMapping("/listPlots")
  public Result listPlots(
    String story, String chapter,
    @RequestParam(defaultValue = "1") int pageNum,
    @RequestParam(defaultValue = "10") int pageSize
  ) {
    return Result.success(service.listPlots(story, chapter, pageNum, pageSize));
  }

  @GetMapping("/listComments")
  public Result listComments(
    String story, String chapter, String username,
    @RequestParam(defaultValue = "1") int pageNum,
    @RequestParam(defaultValue = "10") int pageSize
  ) {
    return Result.success(service.listComments(story, chapter, username, pageNum, pageSize));
  }

  @GetMapping("/listAllComments")
  public Result listAllComments(
    @RequestParam(defaultValue = "1") int pageNum,
    @RequestParam(defaultValue = "10") int pageSize
  ) {
    return Result.success(service.listAllComments(pageNum, pageSize));
  }

  @PostMapping("/editComments")
  public Result editComments(@RequestBody Comment comment) {
    service.editComments(comment.getCommentId(), comment.getCommentContent());
    return Result.success();
  }
  
  @DeleteMapping("/deleteComments")
  public Result deleteComments(Integer commentId) {
    service.deleteComments(commentId);
    return Result.success();
  }
  
  @GetMapping("/listOutcomes")
  public Result listOutcomes(
    Integer decisionValue, Integer decisionId, String story, String chapter,
    @RequestParam(defaultValue = "1") int pageNum,
    @RequestParam(defaultValue = "10") int pageSize
  ) {
    return Result.success(service.listOutcomes(decisionValue, decisionId, story, chapter, pageNum, pageSize));
  }

  @GetMapping("/listChoices")
  public Result listChoices(
    Integer decisionId, String story, String chapter,
    @RequestParam(defaultValue = "1") int pageNum,
    @RequestParam(defaultValue = "10") int pageSize
  ) {
    return Result.success(service.listChoices(decisionId, story, chapter, pageNum, pageSize));
  }

  // @GetMapping("/listImages")
  // public Result listImages(@RequestParam String storyName) {
  //   List<Image> imgList = service.listImages(storyName);

  //   if (imgList.size() > 1) {
  //     return Result.error("multiple data found, please contact the admin as the database is corrupted");
  //   }
  //   else if (imgList.size() <= 0) {
  //     return Result.error("no data found");
  //   } else {
  //     return Result.success(imgList.get(0));
  //   }
  // }
  
}
